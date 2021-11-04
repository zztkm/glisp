export function zip<T, U>(array1: T[], array2: U[]) {
	const len = Math.min(array1.length, array2.length)
	const zipped: [T, U][] = []
	for (let i = 0; i < len; i++) {
		zipped.push([array1[i], array2[i]])
	}
	return zipped
}
