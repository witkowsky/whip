// whip-sensord: the only part of ClaudeWhip that runs as root.
//
// It reads the Apple Silicon accelerometer (via taigrr/apple-silicon-accelerometer,
// MIT, the library behind taigrr/spank), runs spank's detector, and broadcasts
// one JSON line per hit on a unix socket owned by the logged-in user:
//
//	{"ts":1759920000123,"g":0.63,"tier":"slap","severity":"CHOC_MOYEN"}
//
// It never injects keystrokes, plays audio, reads files in your home directory
// or touches the network. Everything else happens in the user-level bridge.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const version = "0.1.0"

type Event struct {
	Type     string  `json:"type,omitempty"`
	TS       int64   `json:"ts"`
	G        float64 `json:"g"`
	Tier     string  `json:"tier"`
	Severity string  `json:"severity,omitempty"`
}

type options struct {
	socket       string
	owner        int
	minG         float64
	windowMs     int
	refractoryMs int
	simulate     bool
	every        float64
	stdout       bool
}

func main() {
	var o options
	flag.StringVar(&o.socket, "socket", "/var/run/claudewhip/sensor.sock", "unix socket to broadcast on")
	flag.IntVar(&o.owner, "owner", -1, "uid that owns the socket (the user running the bridge)")
	flag.Float64Var(&o.minG, "min-g", 0.03, "ignore hits weaker than this (g); the bridge applies your tiers")
	flag.IntVar(&o.windowMs, "window-ms", 120, "peak window after the first trigger")
	flag.IntVar(&o.refractoryMs, "refractory-ms", 250, "quiet time after each hit")
	flag.BoolVar(&o.simulate, "simulate", false, "no hardware, no root: read g values from stdin (or --every)")
	flag.Float64Var(&o.every, "every", 0, "with --simulate: emit a random hit every N seconds")
	flag.BoolVar(&o.stdout, "stdout", false, "also print events to stdout")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()
	if *showVersion {
		fmt.Println("whip-sensord", version)
		return
	}

	if !o.simulate && os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "whip-sensord: reading the accelerometer needs root (IOKit HID). Use --simulate to test without it.")
		os.Exit(1)
	}

	hub, err := Listen(o.socket, o.owner)
	if err != nil {
		fmt.Fprintln(os.Stderr, "whip-sensord: socket:", err)
		os.Exit(1)
	}
	defer hub.Close()

	emit := func(at time.Time, g float64, severity string) {
		ev := Event{TS: at.UnixMilli(), G: round3(g), Tier: TierHint(g), Severity: severity}
		hub.Send(ev)
		if o.stdout {
			fmt.Printf("{\"ts\":%d,\"g\":%.3f,\"tier\":%q,\"severity\":%q}\n", ev.TS, ev.G, ev.Tier, ev.Severity)
		}
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	errc := make(chan error, 1)

	mode := "sensor"
	if o.simulate {
		mode = "simulate"
		go func() { errc <- simulate(o, emit) }()
	} else {
		go func() { errc <- runSensor(o, emit) }()
	}
	fmt.Fprintf(os.Stderr, "whip-sensord %s: %s mode, socket %s (owner uid %d)\n", version, mode, o.socket, o.owner)

	select {
	case <-sig:
	case err := <-errc:
		if err != nil {
			fmt.Fprintln(os.Stderr, "whip-sensord:", err)
			hub.Close()
			os.Exit(1)
		}
	}
}

func round3(g float64) float64 { return float64(int(g*1000+0.5)) / 1000 }

// simulate reads lines like "0.6", "slap" or "wallop" from stdin, or emits a
// random hit every --every seconds. Handy for testing the bridge end to end.
func simulate(o options, emit func(time.Time, float64, string)) error {
	if o.every > 0 {
		t := time.NewTicker(time.Duration(o.every * float64(time.Second)))
		for range t.C {
			emit(time.Now(), 0.1+rand.Float64()*1.1, "SIMULATED")
		}
	}
	named := map[string]float64{"tap": 0.2, "slap": 0.6, "wallop": 1.2}
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		s := strings.TrimSpace(sc.Text())
		if s == "" {
			continue
		}
		g, ok := named[s]
		if !ok {
			v, err := strconv.ParseFloat(s, 64)
			if err != nil || v < 0 || v > 16 {
				fmt.Fprintf(os.Stderr, "ignored %q (want a g value or tap|slap|wallop)\n", s)
				continue
			}
			g = v
		}
		emit(time.Now(), g, "SIMULATED")
	}
	// stdin closed (e.g. launched without a terminal): keep serving.
	select {}
}
