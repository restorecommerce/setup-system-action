import { env, cwd } from 'process';
import { spawn } from 'child_process';
import { join } from 'path';

const testEnv = {
  ...env,
  INPUT_IMPORT: 'true',
  RUNNER_TEMP: '/tmp',
};

test('should bring up stack and import data', (done) => {
  try {
    const ip = join(cwd(), 'dist', 'index.js');
    const proc = spawn('node', [ip], {
      stdio: 'inherit',
      env: testEnv
    });

    proc.on('exit', (code) => {
      console.log('child process exited with code ' + code.toString());
      done();
    });
  } catch (e) {
    if ('stdout' in e) {
      console.log(e.stderr.toString());
      console.log(e.stdout.toString());
    } else {
      console.log(e);
    }

    done();
  }
}, 1000 * 60 * 11);

test('should tear down stack', (done) => {
  try {
    const ip = join(cwd(), 'dist', 'index.js');
    const proc = spawn('node', [ip], {
      stdio: 'inherit',
      env: {
        ...testEnv,
        STATE_isPost: 'true'
      }
    });

    proc.on('exit', (code) => {
      console.log('child process exited with code ' + code.toString());
      done();
    });
  } catch (e) {
    if ('stdout' in e) {
      console.log(e.stderr.toString());
      console.log(e.stdout.toString());
    } else {
      console.log(e);
    }
  }
}, 1000 * 60 * 11);
