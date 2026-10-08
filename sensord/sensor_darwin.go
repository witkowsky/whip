//go:build darwin

package main

import (
	"fmt"
	"time"

	"github.com/taigrr/apple-silicon-accelerometer/detector"
	"github.com/taigrr/apple-silicon-accelerometer/sensor"
	"github.com/taigrr/apple-silicon-accelerometer/shm"
)

// Our own ring name, so running spank at the same time doesn't clobber us.
const ringName = "claudewhip_accel"

// runSensor follows spank's listenForSlaps loop (MIT, Tai Groot): poll the
// shared ring every 10 ms, feed the detector, react to its newest event.
func runSensor(o options, emit func(time.Time, float64, string)) error {
	ring, err := shm.CreateRing(ringName)
	if err != nil {
		return fmt.Errorf("create accel ring: %w", err)
	}
	defer func() {
		ring.Close()
		ring.Unlink()
	}()

	sensorErr := make(chan error, 1)
	go func() { sensorErr <- sensor.Run(sensor.Config{AccelRing: ring}) }()
	time.Sleep(100 * time.Millisecond)

	det := detector.New()
	peak := &Peaker{MinG: o.minG, Window: time.Duration(o.windowMs) * time.Millisecond, Refractory: time.Duration(o.refractoryMs) * time.Millisecond}
	var lastTotal uint64
	var lastEvent time.Time
	const maxBatch = 200

	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case err := <-sensorErr:
			return fmt.Errorf("sensor worker stopped: %v", err)
		case <-tick.C:
		}
		now := time.Now()
		tNow := float64(now.UnixNano()) / 1e9
		samples, total := ring.ReadNew(lastTotal, shm.AccelScale)
		lastTotal = total
		if len(samples) > maxBatch {
			samples = samples[len(samples)-maxBatch:]
		}
		n := len(samples)
		for i, s := range samples {
			mag := det.Process(s.X, s.Y, s.Z, tNow-float64(n-i-1)/float64(det.FS))
			peak.Sample(mag)
		}
		if len(det.Events) > 0 {
			ev := det.Events[len(det.Events)-1]
			if !ev.Time.Equal(lastEvent) {
				lastEvent = ev.Time
				peak.Trigger(now, ev.Amplitude, ev.Severity)
			}
			// The detector keeps up to 500 events; we only ever need the newest.
			if len(det.Events) > 400 {
				det.Events = det.Events[len(det.Events)-1:]
			}
		}
		if h, ok := peak.Poll(now); ok {
			emit(h.At, h.G, h.Severity)
		}
	}
}
