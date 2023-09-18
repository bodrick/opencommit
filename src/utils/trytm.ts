/* eslint-disable unicorn/no-null */
export async function trytm<T>(
  promise: Promise<T>
): Promise<[T, null] | [null, Error]> {
  try {
    const data = await promise;
    return [data, null];
  } catch (error) {
    if (error instanceof Error) return [null, error];

    throw error;
  }
}
