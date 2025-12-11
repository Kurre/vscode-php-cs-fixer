/**
 * Converts snake_case to camelCase
 * @example SnakeToCamelCase<'hello_world'> = 'helloWorld'
 */
export type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
	? `${T}${Capitalize<SnakeToCamelCase<U>>}`
	: S

/**
 * Converts all keys in an object type from snake_case to camelCase
 * @example CamelizeKeys<{hello_world: string}> = {helloWorld: string}
 */
export type CamelizeKeys<T> = {
	[K in keyof T as K extends string ? SnakeToCamelCase<K> : K]: T[K]
}
