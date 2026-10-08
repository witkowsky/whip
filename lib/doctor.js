'use strict';
// `whip doctor`: every check prints ✓/!/✗ and, on failure, the exact fix.
const fs = require('fs');
const { spawnSync } = require('child_process');
const { paths } = require('./paths');
const { readJson } = require('./fsx');
const { loadConfig } = require('./config');
const settings = require('./settings');
const sys = require('./system');
const { findTmux } = require('./hardwhip');
const { fmtDuration } = require('./render');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000, ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function connectable(sock) {
  // Synchronous probe via a child node process (doctor isn't latency sensitive).
  const code = `const s=require('net').createConnection(${JSON.stringify(sock)});s.on('connect',()=>{process.stdout.write('ok');process.exit(0)});s.on('error',e=>{process.stdout.write(e.code||'error');process.exit(1)});setTimeout(()=>process.exit(2),1500)`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 3000 });
  return { ok: r.status === 0, why: r.stdout || 'timeout' };
}

function run({ root, p, fix = false }) {
  let failures = 0;
  const ok = (msg) => console.log(`${p.green('✓')} ${msg}`);
  const warn = (msg, fixMsg) => console.log(`${p.yellow('!')} ${msg}${fixMsg ? `\n    ${p.muted('fix:')} ${fixMsg}` : ''}`);
  const bad = (msg, fixMsg) => {
    failures++;
    console.log(`${p.red('✗')} ${msg}${fixMsg ? `\n    ${p.muted('fix:')} ${fixMsg}` : ''}`);
  };
  const cfg = loadConfig();
  const P = paths();
  console.log(p.bold('ClaudeWhip doctor') + p.muted(`  (state: ${P.home})`));

  // --- runtime
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node} is too old`, 'brew install node (18+)');

  // --- state
  try {
    fs.mkdirSync(P.home, { recursive: true });
    fs.accessSync(P.home, fs.constants.W_OK);
    ok(`state dir writable`);
  } catch (e) {
    bad(`state dir not writable: ${e.message}`, `chown -R "$USER" "${P.home}"`);
  }
  const st = readJson(P.state);
  if (st.ok) ok(`state.json valid (${st.value.total} hits recorded${st.value.paused ? ', PAUSED' : ''})`);
  else if (st.missing) ok('state.json not created yet (first hit creates it)');
  else warn('state.json is corrupt; it self-heals from events.jsonl on the next hit', 'whip simulate --g 0.1  (or just slap)');
  const cf = readJson(P.config);
  if (cf.ok || cf.missing) ok(`config ${cf.missing ? 'defaults' : 'valid'} · tiers tap≥${cfg.thresholds.tapMinG}g slap≥${cfg.thresholds.slapG}g WALLOP≥${cfg.thresholds.wallopG}g · hardWhip=${cfg.hardWhip}`);
  else bad(`config.json is not valid JSON (${cf.error.message})`, `whip config edit   (or delete ${P.config})`);

  // --- plugin + hooks
  const list = sh('claude', ['plugin', 'list', '--json']);
  let plugin = null;
  if (list.ok) {
    try {
      plugin = JSON.parse(list.out).find((x) => x.id === sys.PLUGIN_ID);
    } catch {}
    if (!plugin) bad('plugin whip@claudewhip is not installed', `claude plugin marketplace add "${root}" && claude plugin install ${sys.PLUGIN_ID}`);
    else if (!plugin.enabled) bad('plugin whip@claudewhip is installed but disabled', `claude plugin enable ${sys.PLUGIN_ID}`);
    else {
      const hooksFile = `${plugin.installPath}/hooks/hooks.json`;
      fs.existsSync(hooksFile) ? ok(`plugin enabled (v${plugin.version}) with hooks registered`) : bad(`plugin is enabled but ${hooksFile} is missing`, `claude plugin update ${sys.PLUGIN_ID}`);
    }
  } else warn('could not run `claude plugin list` (is claude on PATH?)');
  const log = require('./fsx').readLines(P.log);
  const lastHook = [...log].reverse().find((l) => l.ev && l.ev !== 'hit');
  if (lastHook) ok(`hooks fired (last: ${lastHook.ev} ${fmtDuration(Date.now() - lastHook.t)} ago)`);
  else warn('no hook activity logged yet', 'start a new Claude Code session; SessionStart should appear in `whip log`');

  // --- status line
  const sl = settings.status();
  if (sl.ours) {
    const m = /node "([^"]+)"/.exec(sl.statusLine.command);
    if (m && !fs.existsSync(m[1])) bad(`statusLine points at a missing script: ${m[1]}`, `re-run ./install.sh from the repo (did it move?)`);
    else {
      const sample = JSON.stringify({ session_id: 'doctor', cwd: root, model: { display_name: 'Doctor' } });
      const t0 = process.hrtime.bigint();
      const r = spawnSync('/bin/sh', ['-c', sl.statusLine.command], { input: sample, encoding: 'utf8', env: { ...process.env, WHIP_HOME: fs.mkdtempSync(require('os').tmpdir() + '/whipdoc-') } });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (r.status === 0 && r.stdout.trim()) ok(`statusLine wired, renders in ${ms.toFixed(0)} ms${sl.statusLine.refreshInterval ? ` (refresh every ${sl.statusLine.refreshInterval}s)` : ' (event-driven only)'}`);
      else bad(`statusLine script failed: ${(r.stderr || '').split('\n')[0]}`, 'WHIP_DEBUG=1 whip status');
    }
  } else if (sl.statusLine) warn(`your own statusLine is active, the whip lane isn't shown`, `./install.sh --wrap  (keeps yours as line 1)`);
  else bad('no statusLine configured', `whip settings install`);
  if (cfg.wrapStatusLine) ok(`wrapping your previous status line: ${cfg.wrapStatusLine}`);
  if (sl.spinnerVerbs) ok('spinnerVerbs set');

  // --- sensor
  const ioreg = sh('/usr/sbin/ioreg', ['-r', '-c', 'AppleSPUHIDDevice', '-l']);
  // One "+-o" block per IORegistry entry; the accelerometer is vendor page 0xFF00, usage 3.
  const hasAccel = ioreg.out.split('+-o ').some((b) => /"PrimaryUsagePage" = 65280\b/.test(b) && /"PrimaryUsage" = 3\b/.test(b));
  hasAccel ? ok('accelerometer present (AppleSPUHIDDevice 0xFF00/3)') : warn('no Apple Silicon accelerometer found (M2+/M1 Pro needed)', 'use /whip, `whip simulate`, or a hotkey bound to `whip manual`');
  if (fs.existsSync(sys.SENSOR_BIN)) {
    const s = fs.statSync(sys.SENSOR_BIN);
    if (s.uid !== 0 || s.mode & 0o022) bad(`${sys.SENSOR_BIN} must be root-owned and not group/world-writable`, `sudo chown root:wheel ${sys.SENSOR_BIN} && sudo chmod 755 ${sys.SENSOR_BIN}`);
    else ok(`sensor binary installed (${sys.SENSOR_BIN}, root-owned)`);
  } else warn('sensor daemon not installed (simulate mode only)', './install.sh   (asks for sudo once)');
  if (fs.existsSync(sys.DAEMON_PLIST)) {
    const lp = sh('/bin/launchctl', ['print', `system/${sys.DAEMON_LABEL}`]);
    if (lp.ok && /state = running/.test(lp.out)) ok('sensor daemon running');
    else bad('sensor daemon installed but not running', `sudo launchctl bootstrap system ${sys.DAEMON_PLIST}; tail /var/log/claudewhip-sensord.log`);
  }
  const sockPath = P.sensorSocket;
  if (fs.existsSync(sockPath)) {
    const s = fs.statSync(sockPath);
    if (s.uid !== process.getuid()) bad(`socket ${sockPath} is owned by uid ${s.uid}, not you`, `re-run ./install.sh (it passes --owner $(id -u))`);
    const c = connectable(sockPath);
    c.ok ? ok(`sensor socket accepts connections (${sockPath})`) : bad(`cannot connect to ${sockPath}: ${c.why}`, 'sudo launchctl kickstart -k system/' + sys.DAEMON_LABEL);
  } else if (fs.existsSync(sys.DAEMON_PLIST)) bad(`socket ${sockPath} missing`, `sudo launchctl kickstart -k system/${sys.DAEMON_LABEL}`);

  // --- bridge
  if (fs.existsSync(sys.AGENT_PLIST)) {
    const lp = sh('/bin/launchctl', ['print', `gui/${process.getuid()}/${sys.AGENT_LABEL}`]);
    if (lp.ok && /state = running/.test(lp.out)) ok('bridge LaunchAgent running');
    else bad('bridge LaunchAgent not running', `launchctl bootstrap gui/$(id -u) ${sys.AGENT_PLIST}; tail ${P.home}/bridge.log`);
  } else warn('bridge LaunchAgent not installed (needed for the real sensor)', './install.sh');

  // --- hard whip
  const tmux = findTmux();
  if (cfg.hardWhip === 'tmux') tmux ? ok(`tmux found (${tmux}); run claude inside tmux for WALLOP interrupts`) : warn('hardWhip=tmux but tmux is not installed', 'brew install tmux   (or: whip config set hardWhip off)');
  if (cfg.hardWhip === 'osascript') {
    const ax = sh('/usr/bin/osascript', ['-e', 'tell application "System Events" to get UI elements enabled']);
    ax.ok && ax.out === 'true' ? ok('Accessibility allowed for this process (osascript hard whip)') : bad('osascript hard whip needs Accessibility permission', `System Settings → Privacy & Security → Accessibility → add ${process.execPath}`);
  }
  if (cfg.sound) fs.existsSync('/usr/bin/afplay') ? ok('sound on (afplay)') : warn('sound on but afplay missing');

  console.log(failures ? p.red(`\n${failures} problem(s) found`) : p.green('\nall good — go slap something'));
  return failures === 0;
}

module.exports = { run };
