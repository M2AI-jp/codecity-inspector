import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  PROVIDER_KEY_NORMALIZE_CONFIG_SHA256,
  normalizeProviderKey,
  providerKeyNormalizationPlanFor
} from '../src/v2/provider-key-normalize.mjs';

const PLAN = providerKeyNormalizationPlanFor({ category: 'character' }, 'monolithic-atlas');

async function pngFixture({
  width = 100,
  height = 100,
  key = [245, 6, 233, 255],
  subject = [0x55, 0x55, 0x55, 255],
  subjectRect = { x: 20, y: 20, width: 60, height: 60 },
  mutate = () => {}
} = {}) {
  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    raw.set(key, index * 4);
  }
  if (subjectRect) {
    for (let y = subjectRect.y; y < subjectRect.y + subjectRect.height; y += 1) {
      for (let x = subjectRect.x; x < subjectRect.x + subjectRect.width; x += 1) {
        raw.set(subject, (y * width + x) * 4);
      }
    }
  }
  mutate(raw, width, height);
  const buffer = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ adaptiveFiltering: false, palette: false, compressionLevel: 9 })
    .toBuffer();
  return { buffer, sourceFormat: 'png', metadata: { width, height }, raw };
}

function pixel(raw, width, x, y) {
  return [...raw.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

test('provider-key-normalize-v1 is strict character monolithic opt-in with bound config', () => {
  assert.equal(
    PROVIDER_KEY_NORMALIZE_CONFIG_SHA256,
    '2c89f2fc52b643cdda6f0496210f6d03d8b3b8b7b5b3fe62d04567dd839f6d10'
  );
  assert.equal(PLAN.configSha256, PROVIDER_KEY_NORMALIZE_CONFIG_SHA256);
  assert.throws(
    () => providerKeyNormalizationPlanFor({ category: 'character' }, 'per-unit'),
    /only for character monolithic-atlas/
  );
  assert.throws(
    () => providerKeyNormalizationPlanFor({ category: 'terrain' }, 'monolithic-atlas'),
    /only for character monolithic-atlas/
  );
});

test('distance 22 and 29 normalize, distance 33 and alpha below 255 reject', async () => {
  for (const key of [[245, 6, 233, 255], [245, 6, 226, 255]]) {
    const image = await pngFixture({ key });
    const normalized = await normalizeProviderKey(image, PLAN);
    assert.equal(normalized.evidence.postBorder.detectedKeyColor, '#FF00FF');
    assert.equal(pixel(normalized.normalizedRaw, 100, 0, 0).join(','), '255,0,255,255');
    assert.deepEqual(pixel(normalized.normalizedRaw, 100, 50, 50), [0x55, 0x55, 0x55, 255]);
  }
  await assert.rejects(
    normalizeProviderKey(await pngFixture({ key: [245, 6, 222, 255] }), PLAN),
    /outside the safe magenta envelope/
  );
  await assert.rejects(
    normalizeProviderKey(await pngFixture({
      mutate(raw) { raw[3] = 254; }
    }), PLAN),
    /alpha 255 for every/
  );
});

test('border gate accepts exactly 995 permille and rejects the next sample', async () => {
  const withOutliers = (count) => pngFixture({
    mutate(raw, width) {
      for (let x = 20; x < 20 + count; x += 1) {
        raw.set([0x55, 0x55, 0x55, 255], x * 4);
      }
    }
  });
  const accepted = await normalizeProviderKey(await withOutliers(12), PLAN);
  assert.equal(accepted.evidence.preBorder.borderSampleCount, 2400);
  assert.equal(accepted.evidence.preBorder.borderInlierCount, 2388);
  assert.equal(accepted.evidence.preBorder.borderInlierPermille, 995);
  assert.equal(accepted.evidence.postBorder.borderInlierPermille, 995);
  await assert.rejects(
    normalizeProviderKey(await withOutliers(13), PLAN),
    /below 995 permille/
  );
});

test('only four-neighbor outer-connected eligible pixels change and outside-mask RGBA is exact', async () => {
  const image = await pngFixture({
    mutate(raw, width) {
      // (20,20) remains connected to the outer key. (21,21) touches it only diagonally.
      raw.set([245, 6, 233, 255], (20 * width + 20) * 4);
      raw.set([245, 6, 233, 255], (21 * width + 21) * 4);
      for (let x = 30; x < 39; x += 1) {
        raw.set([245, 6, 233, 255], (50 * width + x) * 4);
      }
    }
  });
  const normalized = await normalizeProviderKey(image, PLAN);
  assert.deepEqual(pixel(normalized.normalizedRaw, 100, 20, 20), [255, 0, 255, 255]);
  assert.deepEqual(pixel(normalized.normalizedRaw, 100, 21, 21), [245, 6, 233, 255]);
  assert.equal(normalized.evidence.eligibility.disconnectedEligiblePixelCount, 10);
  for (let index = 0; index < normalized.mask.length; index += 1) {
    if (normalized.mask[index]) continue;
    assert.ok(
      image.raw.subarray(index * 4, index * 4 + 4)
        .equals(normalized.normalizedRaw.subarray(index * 4, index * 4 + 4))
    );
  }
  assert.equal(normalized.evidence.outsideMaskPreserved, true);
  await assert.rejects(
    normalizeProviderKey(await pngFixture({
      mutate(raw, width) {
        for (let x = 30; x < 41; x += 1) {
          raw.set([245, 6, 233, 255], (50 * width + x) * 4);
        }
      }
    }), PLAN),
    /disconnected eligible pixels exceed 1 permille/
  );
});

async function connectedFractionFixture(connectedCount) {
  const width = 1000;
  const height = 1000;
  return pngFixture({
    width,
    height,
    subjectRect: null,
    key: [0x55, 0x55, 0x55, 255],
    mutate(raw) {
      const setKey = (x, y) => raw.set([245, 6, 233, 255], (y * width + x) * 4);
      if (connectedCount <= 100000) {
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (x < 6 || x >= 994 || y < 6 || y >= 994) setKey(x, y);
          }
        }
        const frameCount = 1_000_000 - 988 * 988;
        let remaining = connectedCount - frameCount;
        for (let x = 6; x < 994 && remaining > 0; x += 1) {
          for (let y = 6; y < 994 && remaining > 0; y += 1) {
            setKey(x, y);
            remaining -= 1;
          }
        }
        assert.equal(remaining, 0);
      } else {
        for (let index = 0; index < width * height; index += 1) {
          raw.set([245, 6, 233, 255], index * 4);
        }
        let subjectPixels = width * height - connectedCount;
        for (let y = 100; y < 900 && subjectPixels > 0; y += 1) {
          for (let x = 100; x < 900 && subjectPixels > 0; x += 1) {
            raw.set([0x55, 0x55, 0x55, 255], (y * width + x) * 4);
            subjectPixels -= 1;
          }
        }
        assert.equal(subjectPixels, 0);
      }
    }
  });
}

test('connected fraction uses inclusive exact 100..900 permille cross-multiplication', async () => {
  const minimum = await normalizeProviderKey(await connectedFractionFixture(100000), PLAN);
  assert.equal(minimum.evidence.eligibility.connectedPixelCount, 100000);
  const maximum = await normalizeProviderKey(await connectedFractionFixture(900000), PLAN);
  assert.equal(maximum.evidence.eligibility.connectedPixelCount, 900000);
  await assert.rejects(
    normalizeProviderKey(await connectedFractionFixture(99999), PLAN),
    /outside 100\.\.900 permille/
  );
  await assert.rejects(
    normalizeProviderKey(await connectedFractionFixture(900001), PLAN),
    /outside 100\.\.900 permille/
  );
});

test('canonical PNG and evidence are deterministic; plan tamper rejects before derivation', async () => {
  const image = await pngFixture();
  const first = await normalizeProviderKey(image, PLAN);
  const second = await normalizeProviderKey(image, PLAN);
  assert.ok(first.normalizedPng.equals(second.normalizedPng));
  assert.deepEqual(first.evidence, second.evidence);
  assert.equal(first.evidence.sourceOriginal.sha256.length, 64);
  assert.equal(first.evidence.sourceOriginal.decodedRgbaSha256.length, 64);
  assert.equal(first.evidence.normalized.sha256.length, 64);
  assert.equal(first.evidence.normalized.decodedRgbaSha256.length, 64);
  assert.equal(first.evidence.eligibility.maskSha256.length, 64);
  assert.equal(
    first.evidence.sourceOriginal.sha256,
    'dc1ddcf6d96bed3b1452357832cbfebb912de5e41602095c4a9705c52bce0ac1'
  );
  assert.equal(
    first.evidence.normalized.sha256,
    '8a06924353cba7cb8aa701cedae6d31f22b519d11c2b81df6b11a381ca748410'
  );
  assert.equal(
    first.evidence.eligibility.maskSha256,
    '2ddb033439432e46bd7760c143d53d0d86eba9a4cc33a7432e6af97687d9dcb7'
  );
  assert.equal(
    first.evidence.derivationSha256,
    '7b4b6d8ce13481631744f4636e2b63efcdd23ce3960c843674f29fc1b1099b30'
  );
  await assert.rejects(
    normalizeProviderKey(image, { ...PLAN, configSha256: '0'.repeat(64) }),
    /requires its exact plan/
  );
  const jpeg = await sharp(image.raw, { raw: { width: 100, height: 100, channels: 4 } })
    .jpeg()
    .toBuffer();
  await assert.rejects(
    normalizeProviderKey({ ...image, buffer: jpeg }, PLAN),
    /provider-original PNG/
  );
});
