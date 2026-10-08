package main

import (
	"net"
	"os"
	"testing"
	"time"
)

func TestPeakerEmitsOncePerHitWithMaxG(t *testing.T) {
	p := &Peaker{MinG: 0.05, Window: 120 * time.Millisecond, Refractory: 250 * time.Millisecond}
	t0 := time.Unix(1000, 0)
	p.Trigger(t0, 0.2, "CHOC_MOYEN")
	p.Sample(0.5)
	p.Trigger(t0.Add(40*time.Millisecond), 0.4, "CHOC_MAJEUR")
	if _, ok := p.Poll(t0.Add(100 * time.Millisecond)); ok {
		t.Fatal("emitted before window closed")
	}
	h, ok := p.Poll(t0.Add(130 * time.Millisecond))
	if !ok || h.G != 0.5 || !h.At.Equal(t0) {
		t.Fatalf("got %+v ok=%v", h, ok)
	}
	// Ringing inside the refractory period is ignored.
	p.Trigger(t0.Add(200*time.Millisecond), 0.3, "CHOC_MOYEN")
	if _, ok := p.Poll(t0.Add(400 * time.Millisecond)); ok {
		t.Fatal("refractory not respected")
	}
	// A new slap after it is a new hit.
	p.Trigger(t0.Add(500*time.Millisecond), 0.9, "CHOC_MAJEUR")
	if h, ok := p.Poll(t0.Add(700 * time.Millisecond)); !ok || h.G != 0.9 {
		t.Fatalf("second hit: %+v ok=%v", h, ok)
	}
}

func TestPeakerIgnoresBelowMin(t *testing.T) {
	p := &Peaker{MinG: 0.05, Window: 100 * time.Millisecond}
	t0 := time.Unix(1000, 0)
	p.Trigger(t0, 0.01, "VIB_LEGERE")
	if _, ok := p.Poll(t0.Add(time.Second)); ok {
		t.Fatal("emitted a sub-threshold hit")
	}
}

func TestTierHint(t *testing.T) {
	for g, want := range map[float64]string{0.1: "tap", 0.5: "slap", 1.2: "wallop"} {
		if got := TierHint(g); got != want {
			t.Errorf("TierHint(%v)=%s want %s", g, got, want)
		}
	}
}

func TestHubSocketModeAndClientCap(t *testing.T) {
	dir := t.TempDir()
	old, _ := os.Getwd()
	defer os.Chdir(old)
	os.Chdir(dir) // relative path: temp dirs are longer than sun_path allows
	h, err := Listen("s.sock", -1)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	fi, err := os.Lstat("s.sock")
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("socket mode %v err %v", fi.Mode(), err)
	}
	var conns []net.Conn
	for i := 0; i < maxClients+3; i++ {
		c, err := net.Dial("unix", "s.sock")
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, c)
	}
	time.Sleep(100 * time.Millisecond)
	if n := h.Clients(); n != maxClients {
		t.Fatalf("clients=%d want cap %d", n, maxClients)
	}
	for _, c := range conns {
		c.Close()
	}
	// a non-socket file is never replaced
	os.WriteFile("plain", []byte("x"), 0o600)
	if _, err := Listen("plain", -1); err == nil {
		t.Fatal("replaced a regular file")
	}
}
