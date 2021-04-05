import deepClone from 'deep-clone'
import _ from 'lodash'
import peg from 'pegjs'

import _$ from '@/lodash-ext'

import ParserDefinition from './parser.pegjs'

const SymbolIdentiferRegex = /^(:?[a-z_+\-*/=?|<>][0-9a-z_+\-*/=?|<>]*)|(...)$/i

type ExpForm =
	| ExpVoid
	| ExpBoolean
	| ExpInfUnionValue
	| ExpSymbol
	| ExpList
	| ExpSpecialList
	| ExpVector
	| ExpHashMap
	| ExpFn
	| ExpType

interface ExpBase {
	parent?: ExpList | ExpSpecialList | ExpVector | ExpHashMap | ExpFn
	dep?: Set<ExpSymbol>
}

interface ExpProgram {
	ast: 'program'
	value: ExpForm
	delimiters: [string, string]
}

interface ExpVoid extends ExpBase {
	ast: 'void'
}

interface ExpConst<T> extends ExpBase {
	ast: 'const'
	value: T
	subsetOf?: ExpTypeInfUnion
	str?: string
}

type ExpBoolean = ExpConst<boolean>

type ExpNumber = ExpConst<number>

type ExpString = ExpConst<string>

type ExpTypeValue = ExpConst<ExpType>

type ExpInfUnionValue = ExpNumber | ExpString | ExpTypeValue

interface ExpSymbol extends ExpBase {
	ast: 'symbol'
	value: string
	str?: string
	ref?: ExpForm
	evaluated?: ExpForm
}

interface ExpList extends ExpBase {
	ast: 'list'
	value: ExpForm[]
	delimiters?: string[]
	expanded?: ExpForm
	evaluated?: ExpForm
}

interface ExpSpecialList extends ExpBase {
	ast: 'specialList'
	kind: 'typeVector'
	value: ExpForm[]
	variadic: boolean
	delimiters?: string[]
	evaluated?: ExpForm
}

interface ExpVector<T extends ExpForm = ExpForm> extends ExpBase {
	ast: 'vector'
	value: T[]
	delimiters?: string[]
	evaluated?: ExpVector<T>
}

interface ExpHashMap extends ExpBase {
	ast: 'hashMap'
	value: {
		[key: string]: ExpForm
	}
	keyQuoted?: {
		[key: string]: boolean
	}
	delimiters?: (string | [string, string])[]
	evaluated?: ExpHashMap
}

// Types
interface ExpTypeBase extends ExpBase {
	ast: 'type'
	create?: ExpFn
	meta?: ExpHashMap
}

interface ExpTypeAll extends ExpTypeBase {
	kind: 'all'
}

interface ExpTypeInfUnion extends ExpTypeBase {
	kind: 'infUnion'
	subsetOf?: ExpTypeInfUnion
}

interface ExpTypeFn extends ExpTypeBase {
	kind: 'fn'
	params: ExpTypeVector
	out: ExpForm
	lazyEval?: boolean[]
	lazyInfer?: boolean[]
}

interface ExpTypeUnion extends ExpTypeBase {
	kind: 'union'
	items: ExpForm[]
}

interface ExpTypeVector extends ExpTypeBase {
	kind: 'vector'
	items: ExpForm[]
	variadic: boolean
}

type ExpType =
	| ExpTypeAll
	| ExpTypeInfUnion
	| ExpTypeFn
	| ExpTypeUnion
	| ExpTypeVector

type IExpFnValue = (...params: ExpForm[]) => ExpForm

interface ExpFn extends ExpBase {
	ast: 'fn'
	value: IExpFnValue
	type: ExpTypeFn
}

const TypeNumber: ExpTypeInfUnion = {
	ast: 'type',
	kind: 'infUnion',
}

const TypeString: ExpTypeInfUnion = {
	ast: 'type',
	kind: 'infUnion',
}

const TypeType: ExpTypeInfUnion = {
	ast: 'type',
	kind: 'infUnion',
}

;(window as any)['Glisp__builtin__InfUnionTypes'] = {
	Number: TypeNumber,
	String: TypeString,
}

const parser = peg.generate(ParserDefinition)

export function readStr(str: string): ExpForm {
	const program = parser.parse(str) as ExpProgram | null

	if (program) {
		return program.value
	} else {
		return createVoid()
	}
}

function evalStr(str: string): ExpForm {
	return evalExp(readStr(str))
}

function hasAncestor(target: ExpForm, ancestor: ExpForm): boolean {
	return seek(target)

	function seek(target: ExpForm): boolean {
		if (target === ancestor) {
			return true
		}
		if (!target.parent) {
			return false
		}
		return seek(target.parent)
	}
}

export function disconnectExp(exp: ExpForm): null {
	switch (exp.ast) {
		case 'void':
		case 'const':
			return null
		case 'symbol':
			if (exp.ref) {
				// Clear reference
				exp.ref.dep?.delete(exp)
			}
			return null
		case 'fn':
		case 'type':
			throw new Error('I dunno how to handle this...')
	}

	return disconnect(exp)

	function disconnect(e: ExpForm): null {
		switch (e.ast) {
			case 'void':
			case 'const':
			case 'fn':
				return null
			case 'symbol':
				if (e.ref && !hasAncestor(e.ref, exp)) {
					// Clear reference
					e.ref.dep?.delete(e)
					delete e.ref
				}
				return null
			case 'list':
			case 'specialList':
			case 'vector':
				e.value.forEach(disconnect)
				return null
			case 'hashMap':
				_.values(e.value).forEach(disconnect)
				return null
			case 'type':
				throw new Error('これから考える')
		}
	}
}

const TypeAll: ExpTypeAll = {
	ast: 'type',
	kind: 'all',
	create: createFn(
		(v: ExpForm = createVoid()) => v,
		createTypeFn([], {ast: 'type', kind: 'all'})
	),
}
const ConstTrue = createBoolean(true)
const ConstFalse = createBoolean(false)
const TypeBoolean = uniteType([ConstFalse, ConstTrue])

function createTypeVector(items: ExpForm[], variadic: boolean): ExpTypeVector {
	return {
		ast: 'type',
		kind: 'vector',
		items,
		variadic,
	}
}

function createTypeFn(
	params: ExpForm[],
	out: ExpForm,
	{
		variadic = false,
		lazyEval = undefined as undefined | boolean[],
		lazyInfer = undefined as undefined | boolean[],
	} = {}
): ExpTypeFn {
	return {
		ast: 'type',
		kind: 'fn',
		params: createTypeVector(params, variadic),
		out,
		lazyEval,
		lazyInfer,
	}
}

function containsExp(outer: ExpForm, inner: ExpForm): boolean {
	if (outer === inner) {
		return true
	}

	if (inner.ast === 'void') {
		return true
	}

	if (outer.ast !== 'type') {
		return equalExp(outer, inner)
	}

	switch (outer.kind) {
		case 'all':
			return true
		case 'infUnion':
			if (inner.ast === 'const') {
				return !!inner.subsetOf && containsExp(outer, inner.subsetOf)
			}
			if (inner.ast === 'type') {
				if (inner.kind === 'union') {
					return inner.items.every(ii => containsExp(outer, ii))
				}
				if (inner.kind === 'infUnion') {
					return !!inner.subsetOf && containsExp(outer, inner.subsetOf)
				}
			}
			return false
		case 'union': {
			const innerItems =
				inner.ast === 'type' && inner.kind === 'union' ? inner.items : [inner]
			if (outer.items.length < innerItems.length) {
				return false
			}
			return innerItems.every(ii =>
				outer.items.find(_.partial(containsExp, _, ii))
			)
		}
		case 'vector':
			if (
				!(
					inner.ast === 'vector' ||
					(inner.ast === 'type' && inner.kind === 'vector')
				)
			) {
				return false
			}
			if (!outer.variadic) {
				if (inner.ast === 'type' && inner.variadic) {
					return false
				}

				const items = inner.ast === 'vector' ? inner.value : inner.items

				return (
					outer.items.length >= items.length &&
					_$.zipShorter(outer.items, items).every(_$.uncurry(containsExp))
				)
			} else {
				if (inner.ast === 'vector') {
					if (outer.items.length - 1 > inner.value.length) {
						return false
					}
					return inner.value.every((iv, i) => {
						const idx = Math.min(i, outer.items.length - 1)
						const ov = outer.items[idx]
						return containsExp(ov, iv)
					})
				} else {
					if (inner.variadic) {
						// #[x y ...z] #[a b ...c]
						return (
							outer.items.length === inner.items.length &&
							_$.zipShorter(outer.items, inner.items).every(
								_$.uncurry(containsExp)
							)
						)
					} else {
						// #[x y ...z] #[a b]
						if (outer.items.length - 1 > inner.items.length) {
							return false
						}
						return inner.items.every((iv, i) => {
							const idx = Math.min(i, outer.items.length - 1)
							const ov = outer.items[idx]
							return containsExp(ov, iv)
						})
					}
				}
			}
		case 'fn': {
			if (inner.ast === 'type') {
				if (inner.kind === 'fn') {
					return (
						containsExp(outer.params, inner.params) &&
						containsExp(outer.out, inner.out)
					)
				}
				return containsExp(outer.out, inner)
			}
			if (inner.ast === 'fn') {
				return (
					containsExp(outer.params, inner.type.params) &&
					containsExp(outer.out, inner.type.out)
				)
			}
			return containsExp(outer.out, inner)
		}
	}
}

function uniteType(items: ExpForm[]): ExpForm {
	if (items.length === 0) {
		return TypeAll
	}

	const unionType = items.reduce((a, b) => {
		if (containsExp(a, b)) {
			return a
		}
		if (containsExp(b, a)) {
			return b
		}

		const aItems = a.ast === 'type' && a.kind === 'union' ? a.items : [a]
		const bItems = b.ast === 'type' && b.kind === 'union' ? b.items : [b]

		return {
			ast: 'type',
			kind: 'union',
			items: [...aItems, ...bItems],
		}
	})

	if (unionType.ast === 'type' && unionType.kind === 'union') {
		return {...unionType}
	}

	return unionType
}

const ReservedSymbols: {[name: string]: ExpForm} = {
	true: createBoolean(true),
	false: createBoolean(false),
	inf: createNumber(Infinity),
	'-inf': createNumber(-Infinity),
	nan: createNumber(NaN),
	'...': createSymbol('...'),
	All: TypeAll,
	Boolean: TypeBoolean,
	Number: TypeNumber,
	String: TypeString,
	Type: TypeType,
	'#=>': createFn((params: ExpTypeVector, out: ExpForm) => {
		console.log({params, out})
		return createTypeFn(params.items, out, {
			variadic: params.variadic,
		})
	}, createTypeFn([TypeAll, TypeAll], TypeType)),
	'#|': createFn(
		(items: ExpVector<ExpForm>) => uniteType(items.value),
		createTypeFn([TypeAll], TypeAll, {variadic: true})
	),
	'#count': createFn(
		(v: ExpForm) => createNumber(typeCount(v)),
		createTypeFn([TypeAll], TypeNumber)
	),
	let: createFn(
		(_: ExpHashMap, body: ExpForm) => body,
		createTypeFn([createTypeFn([TypeString], TypeAll), TypeAll], TypeAll)
	),
}

const GlobalScope = createList([
	createSymbol('let'),
	createHashMap({
		PI: createNumber(Math.PI),
		'+': createFn(
			(value: ExpVector<ExpNumber>) =>
				createNumber(value.value.reduce((sum, {value}) => sum + value, 0)),
			createTypeFn([TypeNumber], TypeNumber, {variadic: true})
		),
		'*': createFn(
			(value: ExpVector<ExpNumber>) =>
				createNumber(value.value.reduce((prod, {value}) => prod * value, 1)),
			createTypeFn([TypeNumber], TypeNumber, {variadic: true})
		),
		and: createFn(
			(a: ExpBoolean, b: ExpBoolean) => createBoolean(a.value && b.value),
			createTypeFn([TypeBoolean, TypeBoolean], TypeBoolean)
		),
		square: createFn(
			(v: ExpNumber) => createNumber(v.value * v.value),
			createTypeFn([TypeNumber], TypeNumber)
		),
		not: createFn(
			(v: ExpBoolean) => createBoolean(!v.value),
			createTypeFn([TypeBoolean], TypeBoolean)
		),
		'==': createFn(
			(a: ExpForm, b: ExpForm) => createBoolean(equalExp(a, b)),
			createTypeFn([TypeAll, TypeAll], TypeBoolean)
		),
		'#>=': createFn(
			(a: ExpType, b: ExpType) => createBoolean(containsExp(a, b)),
			createTypeFn([TypeAll, TypeAll], TypeBoolean)
		),
		count: createFn(
			(a: ExpVector) => createNumber(a.value.length),
			createTypeFn([TypeAll], TypeNumber)
		),
		if: createFn(
			(cond: ExpBoolean, then: ExpForm, _else: ExpForm) => {
				if (
					cond.ast !== 'const' &&
					cond.ast !== 'infUnionValue' &&
					cond.ast !== 'type'
				) {
					return then
				}
				return cond.value ? _else : then
			},
			createTypeFn([TypeBoolean, TypeAll, TypeAll], TypeAll, {
				lazyEval: [false, true, true],
			})
		),
		ast: createFn(
			(v: ExpForm) => createString(v.ast),
			createTypeFn([TypeAll], TypeString)
		),
	}),
])

function inferType(exp: ExpForm): ExpForm {
	switch (exp.ast) {
		case 'void':
		case 'const':
		case 'type':
			return exp
		case 'symbol':
			return inferType(resolveSymbol(exp))
		case 'list': {
			const first = exp.value[0]

			if (first.ast === 'symbol' && first.value === '=>') {
				return inferType(evalExp(first))
			}
			return inferType(first)
		}
		case 'specialList':
			if (exp.kind === 'typeVector') {
				return TypeType
			}
			break
		case 'vector':
			return createVector(exp.value.map(inferType), false)
		case 'hashMap':
			return createHashMap(_.mapValues(exp.value, inferType))
		case 'fn':
			return exp.type.out
	}
	throw new Error(`Cannot infer this type for now!! ${printExp(exp)}`)
}

function cloneExp<T extends ExpForm>(exp: T) {
	return deepClone(exp)
}

function clearEvaluatedRecursively(exp: ExpForm) {
	switch (exp.ast) {
		case 'symbol':
		case 'list':
		case 'vector':
		case 'hashMap':
			if (!exp.evaluated) {
				return
			}
			delete exp.evaluated
	}

	if (exp.dep) {
		exp.dep.forEach(clearEvaluatedRecursively)
	}
	if (exp.parent) {
		clearEvaluatedRecursively(exp.parent)
	}
}

function equalExp(a: ExpForm, b: ExpForm): boolean {
	if (a === b) {
		return true
	}

	switch (a.ast) {
		case 'void':
			return b.ast === 'void'
		case 'symbol':
			return a.ast === b.ast && a.value === b.value
		case 'const':
			if (b.ast !== 'const') {
				return false
			}
			switch (typeof a.value) {
				case 'boolean':
				case 'number':
				case 'string':
					return a.value === b.value
				default:
					return (
						typeof b.value === 'object' &&
						equalType(a.value, b.value as ExpType)
					)
			}
			break
		case 'list':
		case 'vector':
			return (
				a.ast === b.ast &&
				a.value.length === b.value.length &&
				_$.zipShorter(a.value, b.value).every(_$.uncurry(equalExp))
			)
		case 'specialList':
			return (
				b.ast === 'specialList' &&
				a.variadic === b.variadic &&
				a.value.length === b.value.length &&
				_$.zipShorter(a.value, b.value).every(_$.uncurry(equalExp))
			)
		case 'hashMap':
			return (
				a.ast === b.ast &&
				_.xor(_.keys(a.value), _.keys(b.value)).length === 0 &&
				_.toPairs(a.value).every(([key, av]) => equalExp(av, b.value[key]))
			)
		case 'fn':
			if (b.ast !== 'fn') {
				return false
			}
			if (a.value === b.value) {
				return true
			}
			return false
		case 'type':
			return b.ast === 'type' && equalType(a, b)
	}

	function equalType(a: ExpType, b: ExpType): boolean {
		if (b.ast !== 'type') {
			return false
		}
		switch (a.kind) {
			case 'all':
				return b.kind === 'all'
			case 'infUnion':
				return a === b
			case 'union': {
				if (b.kind !== 'union') return false
				if (a.items.length !== b.items.length) {
					return false
				}
				return _.differenceWith(a.items, b.items, equalExp).length === 0
			}
			case 'fn':
				return (
					b.kind === 'fn' &&
					equalExp(a.out, b.out) &&
					equalExp(a.params, b.params)
				)
			case 'vector':
				return (
					b.kind === 'vector' &&
					a.variadic === b.variadic &&
					a.items.length === b.items.length &&
					_$.zipShorter(a.items, b.items).every(_$.uncurry(equalExp))
				)
		}
	}
}

function resolveSymbol(sym: ExpSymbol): ExpForm {
	if (sym.ref) {
		return sym.ref
	}

	let ref: ExpForm | undefined
	if (sym.value in ReservedSymbols) {
		ref = ReservedSymbols[sym.value]
	} else {
		let parent: ExpForm | undefined = sym

		while ((parent = parent.parent)) {
			if (isListOf('let', parent)) {
				const vars = parent.value[1]

				if (vars.ast !== 'hashMap') {
					throw new Error('2nd parameter of let should be HashMap')
				}

				if ((ref = vars.value[sym.value])) {
					break
				}
			}
		}
	}

	if (!ref) {
		throw new Error(`Symbol ${printExp(sym)} is not defined`)
	}

	sym.ref = ref
	ref.dep = (ref.dep || new Set()).add(sym)

	return ref
}

export class Interpreter {
	private scope: ExpList
	private vars: ExpHashMap

	constructor() {
		this.vars = createHashMap({})

		this.vars.value['def'] = createFn(
			(sym: ExpSymbol, value: ExpForm) => {
				this.vars.value[sym.value] = value
				value.parent = this.vars
				return value
			},
			// NOTE: This should be TypeSymbol
			createTypeFn([TypeAll, TypeAll], TypeAll, {
				lazyEval: [true, true],
				lazyInfer: [true, false],
			})
		)

		this.scope = createList([createSymbol('let'), this.vars])
		this.scope.parent = GlobalScope
	}

	evalExp(exp: ExpForm): ExpForm {
		return evalExp(exp, this.scope)
	}
}

function typeCount(exp: ExpForm): number {
	switch (exp.ast) {
		case 'void':
			return 0
		case 'const':
		case 'symbol':
		case 'vector':
		case 'hashMap':
		case 'fn':
			return 1
		case 'list':
		case 'specialList':
			return typeCount(inferType(exp))
		case 'type':
			switch (exp.kind) {
				case 'all':
				case 'infUnion':
					return Infinity
				case 'union':
					return exp.items.reduce((count, v) => count + typeCount(v), 0)
				case 'vector':
					if (exp.variadic) {
						return Infinity
					} else {
						return exp.items.reduce((count, v) => count * typeCount(v), 1)
					}
				case 'fn':
					return typeCount(exp.out)
			}
	}
}

export function evalExp(
	exp: ExpForm,
	parent: ExpBase['parent'] = GlobalScope
): ExpForm {
	exp.parent = parent
	return evalWithTrace(exp, [])

	function evalWithTrace(exp: ExpForm, trace: ExpForm[]): ExpForm {
		// Check circular reference
		if (trace.includes(exp)) {
			const lastTrace = trace[trace.length - 1]
			throw new Error(`Circular reference ${printExp(lastTrace)}`)
		}
		trace = [...trace, exp]

		// Use cache
		if ('evaluated' in exp && exp.evaluated) {
			return exp.evaluated
		}

		const _eval = _.partial(evalWithTrace, _, trace)

		switch (exp.ast) {
			case 'void':
			case 'const':
			case 'fn':
			case 'type':
				return exp
			case 'symbol': {
				const ref = resolveSymbol(exp)
				return (exp.evaluated = _eval(ref))
			}
			case 'vector': {
				return (exp.evaluated = createVector(exp.value.map(_eval)))
			}
			case 'hashMap': {
				const out: ExpHashMap = {
					ast: 'hashMap',
					value: {},
				}
				Object.entries(exp.value).forEach(
					([sym, v]) => (out.value[sym] = _eval(v))
				)

				return (exp.evaluated = out)
			}
			case 'list': {
				const [first, ...rest] = exp.value

				// Check Special form
				if (first.ast === 'symbol') {
					switch (first.value) {
						case '=>': {
							// Create a function
							const [paramsDef, bodyDef] = rest

							// Validate parameter part
							if (paramsDef.ast !== 'type' || paramsDef.kind !== 'vector') {
								const str = printExp(paramsDef)
								throw new Error(
									`Function parameters '${str}' must be a vector type`
								)
							}

							// Check if every element is symbol
							const nonSymbol = paramsDef.items.find(p => p.ast !== 'symbol')
							if (nonSymbol) {
								throw new Error(
									`Parameter '${printExp(nonSymbol)}' must be a symbol`
								)
							}

							const paramSymbols = paramsDef.items as ExpSymbol[]

							// Find duplicated symbols
							const uniqSymbols = _.uniqWith(paramSymbols, equalExp)

							if (uniqSymbols.length !== paramSymbols.length) {
								const duplicatedSymbols = uniqSymbols.flatMap(sym =>
									paramSymbols.filter(_.partial(equalExp, sym)).length > 1
										? [sym]
										: []
								)
								const str = duplicatedSymbols
									.map(printExp)
									.map(s => `'${s}'`)
									.join(', ')
								throw new Error(
									`Duplicated symbols ${str} has found in parameter`
								)
							}

							// Create scope
							const paramsHashMap = createHashMap(
								Object.fromEntries(paramSymbols.map(sym => [sym.value, sym]))
							)

							const fnScope = createList([
								createSymbol('let'),
								paramsHashMap,
								cloneExp(bodyDef),
							])

							fnScope.parent = exp.parent

							// Define function
							const fn = (...params: ExpForm[]) => {
								// Set params
								paramSymbols.forEach(
									(sym, i) => (paramsHashMap.value[sym.value] = params[i])
								)

								// Evaluate
								const out = _eval(fnScope)

								// Clean params
								paramSymbols.forEach(sym =>
									clearEvaluatedRecursively(paramsHashMap.value[sym.value])
								)

								return out
							}

							// Infer function type
							const paramTypes = Array(paramSymbols.length).fill(TypeAll)
							const outType = inferType(bodyDef)
							const fnType = createTypeFn(paramTypes, outType, {
								variadic: paramsDef.variadic,
							})

							return (exp.evaluated = createFn(fn, fnType))
						}
					}
				}

				const fn = _eval(first)

				let fnType: ExpTypeFn
				let fnValue: IExpFnValue

				if (fn.ast === 'fn') {
					// Function application
					fnType = fn.type
					fnValue = fn.value
				} else {
					throw new Error('First element is not a function')
				}

				const params = createVector(rest, false)
				const assignedParams = assignExp(fnType.params, params)

				console.log(printExp(params), printExp(assignedParams))

				if (assignedParams.ast !== 'vector') {
					throw new Error('why??????????')
				}

				// Eval parameters at first
				const evaluatedParams = assignedParams.value.map((p, i) =>
					fnType.lazyEval && fnType.lazyEval[i] ? p : _eval(p)
				)

				const expanded = (exp.expanded = fnValue(...evaluatedParams))
				return (exp.evaluated = _eval(expanded))
			}
			case 'specialList':
				if (exp.kind === 'typeVector') {
					const items = exp.value.map(_eval)
					return createTypeVector(items, exp.variadic)
				}
				throw new Error('Invalid kind of specialForm')
		}
	}
}

function assignExp(target: ExpForm, _source: ExpForm): ExpForm {
	const sourceType = inferType(_source)

	switch (target.ast) {
		case 'void':
			throw new Error(
				`Cannot assign '${printExp(_source)}' to '${printExp(target)}'`
			)
		case 'const':
			if (!equalExp(target, sourceType)) {
				throw new Error(
					`Cannot assign '${printExp(_source)}' to '${printExp(target)}'`
				)
			}
			return _source
		case 'type':
			if (!containsExp(target, sourceType)) {
				throw new Error(
					`Cannot assign '${printExp(_source)}' to '${printExp(target)}'`
				)
			}
			switch (target.kind) {
				case 'all':
				case 'union':
				case 'infUnion':
					return _source
				case 'vector': {
					if (_source.ast !== 'vector') {
						throw new Error('わけわかんね')
					}
					if (target.variadic) {
						const restPos = target.items.length - 1
						const fixedPart = _.take(_source.value, restPos)
						const restPart = createVector(_source.value.slice(restPos), false)
						return createVector([...fixedPart, restPart], false)
					} else {
						return createVector(
							_.take(_source.value, target.items.length),
							false
						)
					}
				}
				default:
					throw new Error(
						'Sorry! Did not implement the assignExp function for this type so far!!'
					)
			}
		default:
			throw new Error('Cannot assign!!!')
	}
}

// Create functions
function createVoid(): ExpVoid {
	return {ast: 'void'}
}

function createBoolean(value: boolean): ExpBoolean {
	return {
		ast: 'const',
		value,
	}
}

function createNumber(value: number): ExpNumber {
	return {
		ast: 'const',
		subsetOf: TypeNumber,
		value,
	}
}

function createString(value: string): ExpString {
	return {
		ast: 'const',
		subsetOf: TypeString,
		value,
	}
}

function createSymbol(value: string): ExpSymbol {
	return {
		ast: 'symbol',
		value,
	}
}

function createFn(value: (...params: any[]) => ExpBase, type?: ExpForm): ExpFn {
	if (!type || type.ast !== 'type' || type.kind !== 'fn') {
		type = createTypeFn(
			_.times(value.length, () => TypeAll),
			TypeAll
		)
	}

	return {
		ast: 'fn',
		value: typeof value === 'string' ? eval(value) : value,
		type,
	}
}

function createList(value: ExpForm[], setParent = true): ExpList {
	const exp: ExpList = {
		ast: 'list',
		value,
	}

	if (setParent) {
		value.forEach(v => (v.parent = exp))
	}

	return exp
}

function createVector(value: ExpForm[], setParent = true): ExpVector {
	const exp: ExpVector = {
		ast: 'vector',
		value,
	}

	if (setParent) {
		value.forEach(v => (v.parent = exp))
	}

	return exp
}

function createHashMap(value: ExpHashMap['value']): ExpHashMap {
	const exp: ExpHashMap = {
		ast: 'hashMap',
		value,
	}
	Object.values(value).forEach(v => (v.parent = exp))

	return exp
}

function isListOf(sym: string, exp: ExpForm): exp is ExpList {
	if (exp.ast === 'list') {
		const [first] = exp.value
		return first && first.ast === 'symbol' && first.value === sym
	}
	return false
}

export function printExp(exp: ExpForm): string {
	switch (exp.ast) {
		case 'void':
			return 'void'
		case 'const':
			switch (typeof exp.value) {
				case 'boolean':
					return exp.value ? 'true' : 'false'
				case 'number': {
					if (exp.str) {
						return exp.str
					}
					const str = exp.value.toString()
					switch (str) {
						case 'Infinity':
							return 'inf'
						case '-Infinity':
							return '-inf'
						case 'NaN':
							return 'nan'
					}
					return str
				}
				case 'string':
					return `"${exp.value}"`
				default:
					return `Type::${printType(exp.value)}`
			}
		case 'symbol':
			if (exp.str) {
				return exp.str
			} else {
				const {value} = exp
				return SymbolIdentiferRegex.test(value) ? value : `@"${value}"`
			}
		case 'list': {
			return printSeq('(', ')', exp.value, exp.delimiters)
		}
		case 'specialList':
			if (exp.kind === 'typeVector') {
				{
					const value = [...exp.value]
					const delimiters = exp.delimiters || [
						'',
						..._.times(value.length - 1, () => ' '),
						'',
					]
					if (exp.variadic) {
						value.splice(-1, 0, createSymbol('...'))
						delimiters.push('')
					}
					return printSeq('#[', ']', value, delimiters)
				}
			}
			throw new Error('Invalid specialList and cannot print it')
		case 'vector':
			return printSeq('[', ']', exp.value, exp.delimiters)
		case 'hashMap': {
			const {value, keyQuoted, delimiters} = exp
			const keys = Object.keys(value)

			let keyForms: (ExpSymbol | ExpString)[]

			if (keyQuoted) {
				keyForms = keys.map(k =>
					keyQuoted[k] ? createString(k) : createSymbol(k)
				)
			} else {
				keyForms = keys.map(toHashKey)
			}

			let flattenDelimiters: string[]
			let coll: ExpForm[]
			if (delimiters) {
				coll = keys.flatMap((k, i) =>
					Array.isArray(delimiters[i + 1])
						? [keyForms[i], value[k]]
						: [value[k]]
				)
				flattenDelimiters = delimiters.flat()
			} else {
				coll = keys.flatMap((k, i) => [keyForms[i], value[k]])
				flattenDelimiters = [
					'',
					...Array(keys.length - 1)
						.fill([': ', ' '])
						.flat(),
					': ',
					'',
				]
			}
			return printSeq('{', '}', coll, flattenDelimiters)
		}
		case 'fn':
			return `(=> ${printExp(exp.type.params)} ${printExp(exp.type.out)})`
		case 'type':
			return printType(exp)
	}

	function toHashKey(value: string): ExpSymbol | ExpString {
		if (SymbolIdentiferRegex.test(value)) {
			return {ast: 'symbol', value, str: value}
		} else {
			return {ast: 'const', subsetOf: TypeString, value}
		}
	}

	function printType(exp: ExpType): string {
		switch (exp.kind) {
			case 'all':
				return 'All'
			case 'infUnion':
				switch (exp) {
					case TypeNumber:
						return 'Number'
					case TypeString:
						return 'String'
					case TypeType:
						return 'Type'
					default:
						throw new Error('Cannot print this InfUnion')
				}
			case 'vector': {
				const value = [...exp.items]
				const delimiters = ['', ..._.times(value.length - 1, () => ' '), '']
				if (exp.variadic) {
					value.splice(-1, 0, createSymbol('...'))
					delimiters.push('')
				}
				return printSeq('#[', ']', value, delimiters)
			}
			case 'fn':
				return `(#=> ${printExp(exp.params)} ${printExp(exp.out)})`
			case 'union': {
				if (equalExp(exp, TypeBoolean)) {
					return 'Boolean'
				}

				const itemTrue = exp.items.find(_.partial(equalExp, ConstTrue))
				const itemFalse = exp.items.find(_.partial(equalExp, ConstFalse))

				if (itemTrue && itemFalse) {
					return printType({
						...exp,
						items: [
							..._.difference(exp.items, [itemTrue, itemFalse]),
							TypeBoolean,
						],
					})
				}

				const items = exp.items.map(printExp).join(' ')
				return `(#| ${items})`
			}
		}
	}

	function printSeq(
		start: string,
		end: string,
		coll: ExpForm[],
		delimiters?: string[]
	): string {
		if (delimiters) {
			if (delimiters.length === coll.length + 1) {
				return (
					start +
					coll.map((v, i) => delimiters[i] + printExp(v)).join('') +
					delimiters[delimiters.length - 1] +
					end
				)
			}
			console.warn('Invalid length of delimiters')
		}
		return start + coll.map(printExp).join(' ') + end
	}
}
