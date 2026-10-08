'use strict';
// Install locations shared by install.sh, uninstall.sh and `whip doctor`.
const os = require('os');
const path = require('path');

module.exports = {
  SENSOR_BIN: '/Library/PrivilegedHelperTools/com.claudewhip.sensord',
  DAEMON_LABEL: 'com.claudewhip.sensord',
  DAEMON_PLIST: '/Library/LaunchDaemons/com.claudewhip.sensord.plist',
  AGENT_LABEL: 'com.claudewhip.bridge',
  AGENT_PLIST: path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claudewhip.bridge.plist'),
  SOCKET: '/var/run/claudewhip/sensor.sock',
  PLUGIN_ID: 'whip@claudewhip',
  MARKETPLACE: 'claudewhip',
};
