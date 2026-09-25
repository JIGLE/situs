/**
 * `<NIF>/<sub-user>`: nine digits, a slash, and one to four more (manual §4.1, field H.1), such as
 * `555555555/1`. No imports, so the Settings form checks it in the browser too.
 *
 * The NIF's check digit is deliberately not verified: the manual's own example, 555555555, fails
 * it, and AT's test users may too. AT answers a wrong NIF with its own code.
 */
export const AT_USERNAME = /^\d{9}\/\d{1,4}$/;
