import { describe, it, expect } from 'vitest';
import { RetryPolicyCalculator, RetryPolicyConfig } from '@job-scheduler/backend-shared';
import { RetryStrategy } from '@job-scheduler/shared';

describe('RetryPolicyCalculator Unit Tests', () => {
  describe('Fixed Delay Strategy', () => {
    const policy: RetryPolicyConfig = {
      maxAttempts: 5,
      strategy: RetryStrategy.FIXED,
      initialDelayMs: 2000,
      maxDelayMs: 10000,
      jitterMs: 0,
    };

    it('returns the same initial delay for all attempts', () => {
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1)).toBe(2000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 2)).toBe(2000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 3)).toBe(2000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 4)).toBe(2000);
    });
  });

  describe('Linear Backoff Strategy', () => {
    const policy: RetryPolicyConfig = {
      maxAttempts: 5,
      strategy: RetryStrategy.LINEAR,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      jitterMs: 0,
    };

    it('multiplies initial delay by attempt count linearly', () => {
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1)).toBe(1000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 2)).toBe(2000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 3)).toBe(3000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 4)).toBe(4000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 5)).toBe(5000);
    });
  });

  describe('Exponential Backoff Strategy', () => {
    const policy: RetryPolicyConfig = {
      maxAttempts: 5,
      strategy: RetryStrategy.EXPONENTIAL,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2.0,
      jitterMs: 0,
    };

    it('doubles delay on each subsequent attempt', () => {
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1)).toBe(1000); // 1000 * 2^0
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 2)).toBe(2000); // 1000 * 2^1
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 3)).toBe(4000); // 1000 * 2^2
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 4)).toBe(8000); // 1000 * 2^3
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 5)).toBe(16000); // 1000 * 2^4
    });

    it('supports custom backoff multiplier (e.g. 3.0)', () => {
      const customPolicy: RetryPolicyConfig = {
        ...policy,
        backoffMultiplier: 3.0,
      };
      expect(RetryPolicyCalculator.calculateDelayMs(customPolicy, 1)).toBe(1000); // 1000 * 3^0
      expect(RetryPolicyCalculator.calculateDelayMs(customPolicy, 2)).toBe(3000); // 1000 * 3^1
      expect(RetryPolicyCalculator.calculateDelayMs(customPolicy, 3)).toBe(9000); // 1000 * 3^2
    });
  });

  describe('Maximum Delay Ceiling Capping', () => {
    it('strictly caps delay at maxDelayMs', () => {
      const policy: RetryPolicyConfig = {
        maxAttempts: 10,
        strategy: RetryStrategy.EXPONENTIAL,
        initialDelayMs: 5000,
        maxDelayMs: 15000,
        backoffMultiplier: 2.0,
        jitterMs: 0,
      };

      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1)).toBe(5000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 2)).toBe(10000);
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 3)).toBe(15000); // 20000 -> capped at 15000
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 4)).toBe(15000); // 40000 -> capped at 15000
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 5)).toBe(15000); // 80000 -> capped at 15000
    });
  });

  describe('Deterministic Random Injection for Unit Tests', () => {
    it('adds exact predictable jitter when randomFn is supplied', () => {
      const policy: RetryPolicyConfig = {
        maxAttempts: 3,
        strategy: RetryStrategy.FIXED,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        jitterMs: 400,
      };

      // randomFn = 0.0 -> jitter = 0 -> total = 1000
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1, () => 0.0)).toBe(1000);

      // randomFn = 0.5 -> jitter = 200 -> total = 1200
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1, () => 0.5)).toBe(1200);

      // randomFn = 1.0 -> jitter = 400 -> total = 1400
      expect(RetryPolicyCalculator.calculateDelayMs(policy, 1, () => 1.0)).toBe(1400);
    });

    it('calculates deterministic next attempt date', () => {
      const baseDate = new Date('2026-01-01T12:00:00.000Z');
      const policy: RetryPolicyConfig = {
        maxAttempts: 3,
        strategy: RetryStrategy.FIXED,
        initialDelayMs: 5000,
        maxDelayMs: 10000,
        jitterMs: 0,
      };

      const nextDate = RetryPolicyCalculator.calculateNextAttemptAt(policy, 1, baseDate, () => 0);
      expect(nextDate.toISOString()).toBe('2026-01-01T12:00:05.000Z');
    });
  });

  describe('Retry Storm Prevention (Jitter Dispersion)', () => {
    it('disperses 100 simultaneous failures across the jitter window', () => {
      const policy: RetryPolicyConfig = {
        maxAttempts: 3,
        strategy: RetryStrategy.EXPONENTIAL,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        jitterMs: 500,
      };

      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        const delay = RetryPolicyCalculator.calculateDelayMs(policy, 1);
        delays.push(delay);
      }

      // All delays must be within [2000, 2500]
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(2000);
        expect(d).toBeLessThanOrEqual(2500);
      }

      // Must produce a variety of distinct timestamps (spread over time, not identical)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(40);
    });
  });

  describe('isRetryAllowed Boundary Evaluation', () => {
    it('correctly evaluates remaining attempts', () => {
      expect(RetryPolicyCalculator.isRetryAllowed(3, 1)).toBe(true);
      expect(RetryPolicyCalculator.isRetryAllowed(3, 2)).toBe(true);
      expect(RetryPolicyCalculator.isRetryAllowed(3, 3)).toBe(false);
      expect(RetryPolicyCalculator.isRetryAllowed(3, 4)).toBe(false);
    });
  });
});
