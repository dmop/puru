/**
 * Returns a promise that resolves after `ms` milliseconds.
 *
 * Designed for use with `select()` to add timeouts to channel operations or
 * race a deadline against worker results. Also works as a simple async delay.
 *
 * @example
 * // Timeout a channel receive after 2 seconds
 * await select([
 *   [ch.recv(), (value) => handle(value)],
 *   [after(2000), () => handleTimeout()],
 * ])
 *
 * @example
 * // Simple delay
 * await after(500)
 * console.log('500ms later')
 */
export function after(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
