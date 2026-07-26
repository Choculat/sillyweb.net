const { run, cleanup } = require('./harness');

run([
  require('./suites/access'),
  require('./suites/files'),
  require('./suites/serving'),
]).catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
