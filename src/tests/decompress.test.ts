import { describe, it, expect } from 'vitest';
import { decompressFlate, applyPredictor } from '../pdf/decompress';

describe('decompressFlate and Predictors', () => {
  it('handles uncompressed or fallback deflate gracefully', async () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await decompressFlate(raw);
    expect(res).toBeDefined();
    expect(res.length).toBeGreaterThan(0);
  });

  it('applies TIFF predictor (Predictor 2)', () => {
    const raw = new Uint8Array([10, 5, 20, 2]);
    const res = applyPredictor(raw, {
      Predictor: 2,
      Columns: 2,
      Colors: 1,
      BitsPerComponent: 8,
    });

    expect(res[0]).toBe(10);
    expect(res[1]).toBe(15);
    expect(res[2]).toBe(20);
    expect(res[3]).toBe(22);
  });

  it('applies PNG Sub predictor (Predictor 11)', () => {
    const raw = new Uint8Array([1, 10, 5]);
    const res = applyPredictor(raw, {
      Predictor: 11,
      Columns: 2,
      Colors: 1,
      BitsPerComponent: 8,
    });

    expect(res[0]).toBe(10);
    expect(res[1]).toBe(15);
  });

  it('applies PNG Up predictor (Predictor 12)', () => {
    const raw = new Uint8Array([0, 10, 20, 2, 5, 5]);
    const res = applyPredictor(raw, {
      Predictor: 12,
      Columns: 2,
      Colors: 1,
      BitsPerComponent: 8,
    });

    expect(res[0]).toBe(10);
    expect(res[1]).toBe(20);
    expect(res[2]).toBe(15);
    expect(res[3]).toBe(25);
  });

  it('applies PNG Average and Paeth predictors (Predictors 13, 14)', () => {
    const raw = new Uint8Array([
      0, 20, 40,
      3, 10, 10,
      4, 5, 5,
    ]);
    const res = applyPredictor(raw, {
      Predictor: 15,
      Columns: 2,
      Colors: 1,
      BitsPerComponent: 8,
    });

    expect(res[0]).toBe(20);
    expect(res[1]).toBe(40);
    expect(res[2]).toBe(20);
    expect(res[3]).toBe(40);
    expect(res.length).toBe(6);
  });
});
