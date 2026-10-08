package main

import "time"

// Peaker turns a stream of detector triggers into one event per physical hit.
// A slap rings the chassis for ~100 ms and the detector can fire several times
// while it does; we open a short window on the first trigger, keep the highest
// magnitude seen, emit once, then stay quiet for a refractory period.
type Peaker struct {
	MinG       float64
	Window     time.Duration
	Refractory time.Duration

	open     bool
	start    time.Time
	peak     float64
	severity string
	quietTil time.Time
}

type Hit struct {
	At       time.Time
	G        float64
	Severity string
}

// Trigger is called when the detector reports an event with amplitude g.
func (p *Peaker) Trigger(now time.Time, g float64, severity string) {
	if now.Before(p.quietTil) {
		return
	}
	if !p.open {
		if g < p.MinG {
			return
		}
		p.open, p.start, p.peak, p.severity = true, now, g, severity
		return
	}
	if g > p.peak {
		p.peak, p.severity = g, severity
	}
}

// Sample feeds the per-sample magnitude while a window is open.
func (p *Peaker) Sample(g float64) {
	if p.open && g > p.peak {
		p.peak = g
	}
}

// Poll returns a finished hit once the window has elapsed.
func (p *Peaker) Poll(now time.Time) (Hit, bool) {
	if !p.open || now.Sub(p.start) < p.Window {
		return Hit{}, false
	}
	h := Hit{At: p.start, G: p.peak, Severity: p.severity}
	p.open = false
	p.quietTil = now.Add(p.Refractory)
	return h, true
}

// TierHint mirrors the Node defaults; the bridge re-classifies with your config.
func TierHint(g float64) string {
	switch {
	case g >= 0.9:
		return "wallop"
	case g >= 0.45:
		return "slap"
	default:
		return "tap"
	}
}
