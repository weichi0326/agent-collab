import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPythonDist } from './verify-dist.mjs';

test('empty python-dist is rejected before packaging', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-python-dist-'));
  try {
    await assert.rejects(verifyPythonDist(dir), /runtime\/python\.exe/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
