/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
 export function expect<T>(value: T | null | undefined, message: string): T {
    if (value == null) {
      throw new Error(message)
    }
    return value
  }
