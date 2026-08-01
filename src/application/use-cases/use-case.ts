/**
 * One business operation, one class, one public method.
 *
 * Use cases are the application's API. Keeping them at this granularity means
 * every entry point (CLI, HTTP, queue consumer, cron) calls exactly the same
 * code path, and a new delivery mechanism adds no business logic at all.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

/** A use case that takes no input — a query over current state. */
export interface QueryUseCase<TOutput> {
  execute(): Promise<TOutput>;
}
