// Resolve hook: let Node's type-stripping test runner load src files that use
// extensionless relative imports (the project builds with bundler resolution).
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) && !specifier.endsWith('.css')) {
    try {
      return await next(specifier + '.ts', context);
    } catch {
      /* fall through */
    }
  }
  return next(specifier, context);
}
