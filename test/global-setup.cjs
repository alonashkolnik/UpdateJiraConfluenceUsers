// The app loads its built output (dist/, dist-electron/), so build the
// current sources before any test launches it. Set SKIP_BUILD=1 to reuse
// an existing build.
const { execSync } = require('child_process');
const path = require('path');

module.exports = () => {
  if (process.env.SKIP_BUILD) return;
  execSync('npm run build', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
};
