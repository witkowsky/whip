# Third-party notices

ClaudeWhip's Node.js code has no dependencies. The sensor daemon (`sensord/`,
Go) uses the following modules as Go dependencies (not vendored); they are
compiled into `whip-sensord`.

| Module | Version | License | Used for |
|---|---|---|---|
| [github.com/taigrr/apple-silicon-accelerometer](https://github.com/taigrr/apple-silicon-accelerometer) | v0.4.0 | MIT | IOKit HID accelerometer access (`sensor`, `shm`) and the slap detector (`detector`: STA/LTA, CUSUM, kurtosis, peak/MAD) |
| [github.com/ebitengine/purego](https://github.com/ebitengine/purego) | v0.10.2 | Apache-2.0 | calling IOKit/CoreFoundation without cgo (indirect) |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys) | v0.47.0 | BSD-3-Clause | `mmap` for the shared ring buffer (indirect) |

`sensord/sensor_darwin.go` follows the polling loop of
[taigrr/spank](https://github.com/taigrr/spank)'s `listenForSlaps` (MIT,
Copyright (c) 2026 Tai Groot; Copyright (c) 2026 olvvier, original Python
implementation). No spank code is copied verbatim; the detector itself is used
unmodified through the library above.

Ideas (no code) came from OpenWhip (the original "whip Claude" idea),
ComputelessComputer/yamete (targeting the right terminal tab) and
AMOORCHING/pillow (hooks instead of wrapping the CLI).

The sounds in `sounds/` are synthesised by `scripts/gen-sounds.js` and are
released under CC0.

---

## github.com/taigrr/apple-silicon-accelerometer — MIT

```
MIT License

Copyright (c) 2026 olvvier
Copyright (c) 2026 Tai Groot

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## github.com/taigrr/spank — MIT

```
MIT License

Copyright (c) 2026 Tai Groot
Copyright (c) 2026 olvvier (original Python implementation)
(full MIT text as above)
```

## github.com/ebitengine/purego — Apache-2.0

See https://github.com/ebitengine/purego/blob/main/LICENSE

## golang.org/x/sys — BSD-3-Clause

See https://cs.opensource.google/go/x/sys/+/master:LICENSE
