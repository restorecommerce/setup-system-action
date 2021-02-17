import { env, cwd } from 'process';
import { execSync } from 'child_process';
import { join } from 'path';

const testEnv = {
  ...env,
  INPUT_IMPORT: 'true'
};

test('should bring up stack and import data', () => {
  try {
    const ip = join(cwd(), 'dist', 'index.js');
    console.log(execSync(`node ${ip}`, {
      env: testEnv
    }).toString());
  } catch (e) {
    if ('stdout' in e) {
      console.log(e.stderr.toString());
      console.log(e.stdout.toString());
    } else {
      console.log(e);
    }
  }
});

test('should tear down stack', () => {
  try {
    const ip = join(cwd(), 'dist', 'index.js');
    console.log(execSync(`node ${ip}`, {
      env: {
        ...testEnv,
        STATE_isPost: 'true'
      }
    }).toString());
  } catch (e) {
    if ('stdout' in e) {
      console.log(e.stderr.toString());
      console.log(e.stdout.toString());
    } else {
      console.log(e);
    }
  }
});
