import { RetryStrategy } from '@job-scheduler/shared';

export interface RetryPolicyConfig {
  maxAttempts: number;
  strategy: RetryStrategy;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier?: number;
  jitterMs?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 3,
  strategy: RetryStrategy.EXPONENTIAL,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterMs: 500,
};

export class RetryPolicyCalculator {
  /**
   * Determine if a retry attempt is allowed based on max attempts.
   * @param maxAttempts Total allowed attempts (e.g. 3)
   * @param currentAttempt 1-based current attempt count (e.g. 1 after first attempt)
   */
  static isRetryAllowed(maxAttempts: number, currentAttempt: number): boolean {
    return currentAttempt < maxAttempts;
  }

  /**
   * Calculate the delay in milliseconds for the next retry attempt.
   *
   * @param policy Retry policy configuration
   * @param attempt 1-based attempt number that just completed and failed (e.g. attempt 1 failed -> calculating delay before attempt 2)
   * @param randomFn Optional random generator returning [0, 1] for deterministic unit testing
   * @returns Delay in milliseconds before next attempt
   */
  static calculateDelayMs(
    policy: Partial<RetryPolicyConfig> = {},
    attempt: number = 1,
    randomFn: () => number = Math.random
  ): number {
    const config: RetryPolicyConfig = {
      ...DEFAULT_RETRY_POLICY,
      ...policy,
    };

    const initialDelay = Math.max(0, config.initialDelayMs);
    const maxDelay = Math.max(initialDelay, config.maxDelayMs);
    const multiplier = Math.max(1.0, config.backoffMultiplier ?? 2.0);
    const jitterMax = Math.max(0, config.jitterMs ?? 0);

    let baseDelay = initialDelay;

    // Calculate base delay by strategy
    switch (config.strategy) {
      case RetryStrategy.FIXED:
        baseDelay = initialDelay;
        break;

      case RetryStrategy.LINEAR:
        // Attempt 1 -> 1 * initial, Attempt 2 -> 2 * initial, Attempt 3 -> 3 * initial
        baseDelay = initialDelay * Math.max(1, attempt);
        break;

      case RetryStrategy.EXPONENTIAL:
      default:
        // Attempt 1 -> initial * multiplier^0 = initial
        // Attempt 2 -> initial * multiplier^1 = initial * 2
        // Attempt 3 -> initial * multiplier^2 = initial * 4
        const exponent = Math.max(0, attempt - 1);
        baseDelay = initialDelay * Math.pow(multiplier, exponent);
        break;
    }

    // Apply ceiling cap
    const cappedDelay = Math.min(baseDelay, maxDelay);

    // Apply full jitter: random value between 0 and jitterMax
    const jitter = jitterMax > 0 ? Math.min(jitterMax, Math.round(randomFn() * jitterMax)) : 0;

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Compute the exact Date for the next attempt.
   */
  static calculateNextAttemptAt(
    policy: Partial<RetryPolicyConfig> = {},
    attempt: number = 1,
    fromDate: Date = new Date(),
    randomFn: () => number = Math.random
  ): Date {
    const delayMs = this.calculateDelayMs(policy, attempt, randomFn);
    return new Date(fromDate.getTime() + delayMs);
  }
}
