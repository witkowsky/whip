package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// The bridge and `whip calibrate` are the only expected readers.
const maxClients = 8

// Hub is a tiny line-oriented broadcast server on a unix socket. Clients only
// read; anything they send is ignored. A slow client loses events rather than
// slowing down the sensor loop.
type Hub struct {
	mu      sync.Mutex
	clients map[net.Conn]chan []byte
	ln      net.Listener
	path    string
}

// Listen creates the socket. When running as root the directory must be
// root-owned and not group/world-writable, so we never write into a path
// someone else controls. The socket is created 0600 (umask) and then lchowned
// to the user the bridge runs as; nothing here follows a symlink.
func Listen(path string, owner int) (*Hub, error) {
	if len(path) > 103 {
		return nil, fmt.Errorf("socket path is %d bytes; macOS allows 103 (sun_path). Use a shorter or relative path", len(path))
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	fi, err := os.Lstat(dir)
	if err != nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("refusing socket dir %s: not a real directory", dir)
	}
	if os.Geteuid() == 0 {
		st, ok := fi.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 || fi.Mode().Perm()&0o022 != 0 {
			return nil, fmt.Errorf("refusing socket dir %s: must be root-owned and not group/world-writable", dir)
		}
	}
	if fi, err := os.Lstat(path); err == nil {
		if fi.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket %s", path)
		}
		_ = os.Remove(path)
	}
	old := syscall.Umask(0o177) // socket is born 0600: no window before a chmod
	ln, err := net.Listen("unix", path)
	syscall.Umask(old)
	if err != nil {
		return nil, err
	}
	if owner >= 0 {
		if err := os.Lchown(path, owner, -1); err != nil {
			ln.Close()
			return nil, fmt.Errorf("chown socket: %w", err)
		}
	}
	h := &Hub{clients: map[net.Conn]chan []byte{}, ln: ln, path: path}
	go h.accept()
	return h, nil
}

func (h *Hub) accept() {
	for {
		c, err := h.ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			// EMFILE and friends are transient; never stop serving.
			time.Sleep(50 * time.Millisecond)
			continue
		}
		ch := make(chan []byte, 64)
		h.mu.Lock()
		if len(h.clients) >= maxClients {
			h.mu.Unlock()
			c.Close()
			continue
		}
		h.clients[c] = ch
		h.mu.Unlock()
		go h.writer(c, ch)
		go h.drain(c)
	}
}

func (h *Hub) writer(c net.Conn, ch chan []byte) {
	for b := range ch {
		if _, err := c.Write(b); err != nil {
			break
		}
	}
	h.drop(c)
}

// drain notices disconnects; client input is discarded.
func (h *Hub) drain(c net.Conn) {
	buf := make([]byte, 256)
	for {
		if _, err := c.Read(buf); err != nil {
			h.drop(c)
			return
		}
	}
}

func (h *Hub) drop(c net.Conn) {
	h.mu.Lock()
	if ch, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(ch)
	}
	h.mu.Unlock()
	c.Close()
}

func (h *Hub) Send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	b = append(b, '\n')
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, ch := range h.clients {
		select {
		case ch <- b:
		default: // slow reader: drop
		}
	}
}

func (h *Hub) Clients() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func (h *Hub) Close() {
	h.ln.Close()
	_ = os.Remove(h.path)
}
