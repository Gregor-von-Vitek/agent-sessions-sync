import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // On Windows, @vscode/test-electron truncates CLI args on spaces, so a project path
  // containing spaces breaks --extensionTestsPath. ASS_DEV_PATH lets the caller point at a
  // space-free location (e.g. a directory junction) to work around that.
  const overrideRoot = process.env.ASS_DEV_PATH;
  const extensionDevelopmentPath = overrideRoot
    ? path.resolve(overrideRoot)
    : path.resolve(__dirname, '../../..');
  const extensionTestsPath = overrideRoot
    ? path.resolve(overrideRoot, 'out-test/test/integration/suite')
    : path.resolve(__dirname, './suite');
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}

void main();
