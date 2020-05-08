import Env from './env'

export type MalJSFunc = (...args: MalVal[]) => MalVal | never

export const M_META = Symbol('meta')
export const M_AST = Symbol('ast')
export const M_ENV = Symbol('env')
export const M_PARAMS = Symbol('params')
export const M_ISMACRO = Symbol('ismacro')
export const M_START = Symbol('start')
export const M_END = Symbol('end')
export const M_EVAL = Symbol('eval')
export const M_FN = Symbol('fn')
export const M_OUTER = Symbol('outer')
const M_ISVECTOR = Symbol('isvector')

export type MalBind = (string | MalBind)[]

export interface MalFunc {
	(...args: MalVal[]): MalVal
	[M_META]: MalVal
	[M_AST]: MalVal
	[M_ENV]: Env
	[M_PARAMS]: MalBind
	[M_ISMACRO]: boolean
}

export class LispError extends Error {}

export type MalMap = {[keyword: string]: MalVal}

interface MalNodeMap extends MalMap {
	[M_START]: number
	[M_END]: number
	[M_EVAL]: MalVal
	[M_OUTER]: MalVal
}

export interface MalListNode extends Array<MalVal> {
	[M_START]: number
	[M_END]: number
	[M_EVAL]: MalVal
	[M_OUTER]: MalVal
}

export type MalNode = MalNodeMap | MalListNode

export type MalVal =
	| number
	| string
	| boolean
	| null
	| MalAtom
	| MalFunc
	| MalJSFunc
	| MalMap
	| MalVal[]
	| MalNode
	| Float32Array

// General Functions
export function isEqual(a: MalVal, b: MalVal) {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false
		}
		for (let i = 0; i < a.length; i++) {
			if (!isEqual(a[i], b[i])) {
				return false
			}
		}
		return true

		// eslint-disable-next-line @typescript-eslint/no-use-before-define
	} else if (isMap(a) && isMap(b)) {
		if (a.size !== b.size) {
			return false
		}
		for (const k of Object.keys(a)) {
			const aval = a[k],
				bval = b[k]
			if (aval === undefined || bval === undefined || !isEqual(aval, bval)) {
				return false
			}
		}
		return true
	} else {
		return a === b
	}
}

export function cloneExp(obj: MalVal, newMeta?: MalVal): MalVal {
	let newObj = null
	if (Array.isArray(obj)) {
		newObj = [...obj]
		// eslint-disable-next-line @typescript-eslint/no-use-before-define
		if (isVector(obj)) {
			// eslint-disable-next-line @typescript-eslint/no-use-before-define
			markMalVector(newObj)
		}
		// eslint-disable-next-line @typescript-eslint/no-use-before-define
	} else if (isMap(obj)) {
		newObj = {...obj}
	} else if (obj instanceof Function) {
		// new function instance
		const fn = (...args: any) => obj.apply(fn, args)
		// copy original properties
		newObj = Object.assign(fn, obj)
	} else {
		throw new LispError('[JS: cloneExp] Unsupported type for clone')
	}

	if (typeof newMeta !== 'undefined') {
		;(newObj as MalFunc)[M_META] = newMeta
	}

	return newObj
}

// Functions
export function createMalFunc(
	fn: (...args: MalVal[]) => MalVal,
	exp: MalVal,
	env: Env,
	params: MalBind,
	meta = null,
	ismacro = false
): MalFunc {
	const attrs = {
		[M_AST]: exp,
		[M_ENV]: env,
		[M_PARAMS]: params,
		[M_META]: meta,
		[M_ISMACRO]: ismacro
	}
	return Object.assign(fn, attrs)
}

const KEYWORD_PREFIX = '\u029e'
const SYMBOL_PREFIX = '\u01a8'

export const isMalFunc = (obj: MalVal): obj is MalFunc =>
	obj && (obj as MalFunc)[M_AST] ? true : false

// String
export const isString = (obj: MalVal): obj is string =>
	typeof obj === 'string' &&
	obj[0] !== SYMBOL_PREFIX &&
	obj[0] !== KEYWORD_PREFIX

// Symbol
// Use \u01a8 as the prefix of symbol for AST object
export const isSymbol = (obj: MalVal): obj is string =>
	typeof obj === 'string' && obj[0] === SYMBOL_PREFIX

export const symbolFor = (k: string) => SYMBOL_PREFIX + k

// Keyword
// Use \u029e as the prefix of keyword instead of colon (:) for AST object
export const isKeyword = (obj: MalVal): obj is string =>
	typeof obj === 'string' && obj[0] === KEYWORD_PREFIX

export const keywordFor = (k: string) => KEYWORD_PREFIX + k

// List
export const isList = (obj: MalVal): obj is MalVal[] =>
	Array.isArray(obj) && !(obj as any)[M_ISVECTOR]

// Vectors
export const isVector = (obj: MalVal): obj is MalVal[] =>
	Array.isArray(obj) && !!(obj as any)[M_ISVECTOR]

export function createMalVector<T>(_arr: Array<T>): Array<T> {
	const arr = [..._arr]
	;(arr as any)[M_ISVECTOR] = true
	return arr
}

export function markMalVector(arr: MalVal[]): MalVal[] {
	;(arr as any)[M_ISVECTOR] = true
	return arr
}

// Maps
export const isMap = (obj: MalVal): obj is MalMap =>
	obj !== null &&
	typeof obj === 'object' &&
	!isMalFunc(obj) &&
	!(obj instanceof MalAtom) && // eslint-disable-line @typescript-eslint/no-use-before-define
	!Array.isArray(obj)

export function assocBang(hm: MalMap, ...args: any[]) {
	if (args.length % 2 === 1) {
		throw new LispError('Odd number of map arguments')
	}
	for (let i = 0; i < args.length; i += 2) {
		if (typeof args[i] !== 'string') {
			throw new LispError('Hash map can only use string/symbol/keyword as key')
		}
		hm[args[i]] = args[i + 1]
	}
	return hm
}

// Atoms
export class MalAtom {
	public val: MalVal

	constructor(val: MalVal) {
		this.val = val
	}
}

type MalTypeString =
	| 'list'
	| 'vector'
	| 'map'
	| 'nil'
	| 'symbol'
	| 'keyword'
	| 'string'
	| 'boolean'
	| 'number'
	| 'atom'

export function getType(obj: MalVal): MalTypeString | null {
	if (Array.isArray(obj)) {
		if ((obj as any)[M_ISVECTOR]) {
			return 'vector'
		} else {
			return 'list'
		}
	} else if (isMap(obj)) {
		return 'map'
	} else if (obj === null) {
		return 'nil'
	} else {
		switch (typeof obj) {
			case 'string':
				switch (obj[0]) {
					case SYMBOL_PREFIX:
						return 'symbol'
					case KEYWORD_PREFIX:
						return 'keyword'
					default:
						return 'string'
				}
			case 'boolean':
				return 'boolean'
			case 'number':
				return 'number'
			case 'object':
				if (obj instanceof MalAtom) {
					return 'atom'
				}
		}
	}
	return null
}

// Namespace
export interface MalNamespace {
	jsObjects?: [string, any, any][]
	malCode?: string
}
