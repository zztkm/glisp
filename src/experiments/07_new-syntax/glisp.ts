import _ from 'lodash'
import peg from 'pegjs'

import _$ from '@/lodash-ext'

import ParserDefinition from './parser.pegjs'

function canOmitQuote(name: string) {
	return (
		name === '...' || name.match(/^#?[a-z_+\-*/=?|&<>][0-9a-z_+\-*/=?|&<>]*$/i)
	)
}

type Form = Exp | Value

// Value
type Value =
	| ValuePrim
	| Value[]
	| ValueAll
	| ValueVoid
	| ValueRestVector
	| ValueHashMap
	| ValueFn
	| ValueUnion
	| ValueInfUnion
	| ValueFnType

type ValuePrim = null | boolean | number | string

interface ValueAll {
	type: 'all'
}

interface ValueVoid {
	type: 'void'
}

interface ValueRestVector {
	type: 'restVector'
	value: Value[]
}

interface ValueHashMap {
	type: 'hashMap'
	value: {
		[key: string]: Value
	}
}

type IFn = (...params: Form[]) => Form

interface ValueFn {
	type: 'fn'
	body: IFn
	fnType: ValueFnType
}

interface ValueUnion {
	type: 'union'
	items: Value[]
	original?: ExpValue<ValueUnion>
}

interface ValueInfUnion {
	type: 'infUnion'
	predicate: (v: ValuePrim) => boolean
	original?: ExpValue<ValueInfUnion>
	supersets?: ValueInfUnion[]
}

interface ValueFnType {
	type: 'fnType'
	params: Value[] | ValueRestVector
	out: Value
	lazyEval?: boolean[]
	lazyInfer?: boolean[]
}

// Exp
type Exp = ExpValue | ExpSymbol | ExpList | ExpVector | ExpHashMap

interface ExpBase {
	parent?: ExpList | ExpVector | ExpHashMap
	dep?: Set<ExpSymbol>
	label?: {
		str: string
		delimiters?: string[]
	}
}

interface ExpProgram {
	ast: 'program'
	value: Exp
	delimiters: [string, string]
}

interface ExpValue<T extends Value = Value> extends ExpBase {
	ast: 'value'
	value: T
	str?: string
}

interface ExpSymbol extends ExpBase {
	ast: 'symbol'
	value: string
	str?: string
	ref?: Exp
}

interface ExpList extends ExpBase {
	ast: 'list'
	value: Exp[]
	delimiters?: string[]
	expanded?: Form
	evaluated?: Value
}

interface ExpVector extends ExpBase {
	ast: 'vector'
	value: Exp[]
	rest: boolean
	delimiters?: string[]
	evaluated?: Value[]
}

interface ExpHashMap extends ExpBase {
	ast: 'hashMap'
	value: {
		[key: string]: Exp
	}
	delimiters?: string[]
	evaluated?: ValueHashMap
}

function wrapTypeInfUnion(value: ValueInfUnion) {
	const exp: ExpValue<ValueInfUnion> = {
		ast: 'value',
		value,
	}
	value.original = exp
	return exp
}

function wrapTypeUnion(value: ValueUnion) {
	const exp: ExpValue<ValueUnion> = {
		ast: 'value',
		value,
	}
	value.original = exp
	return exp
}

//-------------------------------------------------------
// Types

const TypeNumber = createTypeInfUnion({
	predicate: v => typeof v === 'number',
})

const TypeInt = createTypeInfUnion({
	supersets: [TypeNumber],
	predicate: v => Number.isInteger(v),
})

const TypePosNumber = createTypeInfUnion({
	supersets: [TypeNumber],
	predicate: v => typeof v === 'number' && v >= 0,
})

const TypeNat = createTypeInfUnion({
	supersets: [TypeInt, TypePosNumber],
	predicate: v => typeof v === 'number' && v >= 0 && Number.isInteger(v),
})

const TypeString = createTypeInfUnion({
	predicate: v => typeof v === 'string',
})

const parser = peg.generate(ParserDefinition)

export function readStr(str: string): Exp {
	const program = parser.parse(str) as ExpProgram | null

	if (program) {
		return program.value
	} else {
		return wrapExp(createVoid())
	}
}

function hasAncestor(target: Exp, ancestor: Exp): boolean {
	return seek(target)

	function seek(target: Exp): boolean {
		if (target === ancestor) {
			return true
		}
		if (!target.parent) {
			return false
		}
		return seek(target.parent)
	}
}

export function disconnectExp(exp: Exp): null {
	switch (exp.ast) {
		case 'value':
			return null
		case 'symbol':
			if (exp.ref) {
				// Clear reference
				exp.ref.dep?.delete(exp)
			}
			return null
	}

	return disconnect(exp)

	function disconnect(e: Exp): null {
		switch (e.ast) {
			case 'value':
				return null
			case 'symbol':
				if (e.ref && !hasAncestor(e.ref, exp)) {
					// Clear reference
					e.ref.dep?.delete(e)
					delete e.ref
				}
				return null
			case 'list':
				e.value.forEach(disconnect)
				return null
			case 'vector':
				e.value.forEach(disconnect)
				return null
			case 'hashMap':
				_.values(e.value).forEach(disconnect)
				return null
		}
	}
}

const TypeAll: ValueAll = {
	type: 'all',
}

const TypeBoolean: ValueUnion = {
	type: 'union',
	items: [true, false],
}

function createTypeInfUnion(
	exp: Omit<ValueInfUnion, 'type' | 'original'>
): ValueInfUnion {
	return {
		type: 'infUnion',
		...exp,
	}
}
function createTypeFn(
	params: Value[] | ValueRestVector,
	out: Value,
	{
		lazyEval = undefined as undefined | boolean[],
		lazyInfer = undefined as undefined | boolean[],
	} = {}
): ValueFnType {
	return {
		type: 'fnType',
		params,
		out,
		lazyEval,
		lazyInfer,
	}
}

function containsValue(outer: Value, inner: Value): boolean {
	if (outer === inner) {
		return true
	}

	if (isValuePrim(outer)) {
		return isEqualValue(outer, inner)
	}

	if (Array.isArray(outer)) {
		return (
			Array.isArray(inner) &&
			outer.length >= inner.length &&
			_$.zipShorter(outer, inner).every(_.spread(containsValue))
		)
	}

	if (isValueVoid(inner)) {
		return true
	}

	switch (outer.type) {
		case 'void':
		case 'fn':
			return isEqualValue(outer, inner)
		case 'restVector':
			if (isValueRestVector(inner)) {
				return (
					outer.value.length === inner.value.length &&
					_$.zipShorter(outer.value, inner.value).every(_.spread(containsValue))
				)
			}
			if (Array.isArray(inner)) {
				return (
					outer.value.length - 1 <= inner.length &&
					_$.zipShorter(outer.value, inner).every(_.spread(containsValue))
				)
			}
			return false
		case 'hashMap':
			return (
				isValueHashMap(inner) &&
				_.entries(inner).every(([key, iv]) =>
					containsValue(outer.value[key], iv)
				)
			)
		case 'all':
			return true
		case 'infUnion':
			if (isValuePrim(inner)) {
				return outer.predicate(inner)
			}
			if (isValueUnion(inner)) {
				return inner.items.every(ii => containsValue(outer, ii))
			}
			if (isValueInfUnion(inner)) {
				if (outer.original === inner.original) {
					return true
				}
				return (
					!!inner.supersets &&
					inner.supersets.some(s => containsValue(outer, s))
				)
			}
			return false
		case 'union': {
			const innerItems = isValueUnion(inner) ? inner.items : [inner]
			if (outer.items.length < innerItems.length) {
				return false
			}
			return !!innerItems.some(ii =>
				outer.items.some(_.partial(containsValue, _, ii))
			)
		}
		case 'fnType':
			if (isValueFnType(inner)) {
				return (
					containsValue(outer.params, inner.params) &&
					containsValue(outer.out, inner.out)
				)
			}
			if (isValueFn(inner)) {
				return (
					containsValue(outer.params, inner.fnType.params) &&
					containsValue(outer.out, inner.fnType.out)
				)
			}
			return containsValue(outer.out, inner)
	}
}

function uniteType(items: Value[]): Value {
	if (items.length === 0) {
		return TypeAll
	}

	const unionType = items.reduce((a, b) => {
		if (containsValue(a, b)) {
			return a
		}
		if (containsValue(b, a)) {
			return b
		}

		const aItems = isValueUnion(a) ? a.items : [a]
		const bItems = isValueUnion(b) ? b.items : [b]

		return {
			type: 'union',
			items: [...aItems, ...bItems],
		}
	}, createVoid())

	if (isValueUnion(unionType)) {
		return {...unionType}
	}

	return unionType
}

function wrapExp<T extends Value>(value: T): ExpValue<T> {
	return {
		ast: 'value',
		value,
	}
}

const GlobalScope = createList([
	createSymbol('let'),
	createSpecialListHashMap({
		Boolean: wrapTypeUnion(TypeBoolean),
		Number: wrapTypeInfUnion(TypeNumber),
		PosNumber: wrapTypeInfUnion(TypePosNumber),
		Int: wrapTypeInfUnion(TypeInt),
		Nat: wrapTypeInfUnion(TypeNat),
		String: wrapTypeInfUnion(TypeString),
		'#=>': createFn(
			(params: Value[], out: Value) => createTypeFn(params, out),
			createTypeFn([TypeAll, TypeAll], TypeAll)
		),
		'#|': createFn(
			(items: Value[]) => uniteType(items),
			createTypeFn(createVariadicVector([TypeAll]), TypeAll)
		),
		'#count': createFn(
			(v: Value) => typeCount(v),
			createTypeFn([TypeAll], TypeNumber)
		),
		'#<==': createFn(
			(type: Value, value: Exp) => assignExp(type, value),
			createTypeFn([TypeAll, TypeAll], TypeAll, {
				lazyEval: [false, true],
			})
		),
		length: createFn(
			(v: Value[] | ValueRestVector) =>
				Array.isArray(v) ? v.length : Infinity,
			createTypeFn([createVariadicVector([TypeAll])], TypeNat)
		),
		let: createFn(
			(_: ValueHashMap, body: Exp) => body,
			createTypeFn([createTypeFn([TypeString], TypeAll), TypeAll], TypeAll)
		),
		PI: wrapExp(Math.PI),
		'+': createFn((xs: number[]) => {
			console.log(xs)
			return xs.reduce((sum, v) => sum + v, 0)
		}, createTypeFn(createVariadicVector([TypeNumber]), TypeNumber)),
		'*': createFn(
			(xs: number[]) => xs.reduce((prod, v) => prod * v, 1),
			createTypeFn(createVariadicVector([TypeNumber]), TypeNumber)
		),
		take: createFn((n: number, coll: Value[] | ValueRestVector) => {
			if (Array.isArray(coll)) {
				return coll.slice(0, n)
			} else {
				const newColl = coll.value.slice(0, n)
				newColl.push(
					..._.times(
						n - newColl.length,
						() => coll.value[coll.value.length - 1]
					)
				)
				return newColl
			}
		}, createTypeFn([TypeNat, createVariadicVector([TypeAll])], TypeNumber)),
		'&&': createFn(
			(a: boolean, b: boolean) => a && b,
			createTypeFn([TypeBoolean, TypeBoolean], TypeBoolean)
		),
		square: createFn(
			(v: number) => v * v,
			createTypeFn([TypeNumber], TypePosNumber)
		),
		sqrt: createFn(
			(v: number) => Math.sqrt(v),
			createTypeFn([TypePosNumber], TypePosNumber)
		),
		not: createFn((v: boolean) => !v, createTypeFn([TypeBoolean], TypeBoolean)),
		'==': createFn(
			(a: Value, b: Value) => isEqualValue(a, b),
			createTypeFn([TypeAll, TypeAll], TypeBoolean)
		),
		'#>=': createFn(
			(a: Value, b: Value) => containsValue(a, b),
			createTypeFn([TypeAll, TypeAll], TypeBoolean)
		),
		count: createFn(
			(a: Value[]) => a.length,
			createTypeFn([TypeAll], TypeNumber)
		),
		if: createFn(
			(cond: boolean, then: Exp, _else: Exp) => {
				return cond ? then : _else
			},
			createTypeFn([TypeBoolean, TypeAll, TypeAll], TypeAll, {
				lazyEval: [false, true, true],
			})
		),
	}),
])

function isValue(form: Form): form is Value {
	return isValuePrim(form) || Array.isArray(form) || 'valueType' in form
}

function isValueFn(form: Form): form is ValueFn {
	return !isValuePrim(form) && 'type' in form && form.type === 'fn'
}

function isValuePrim(value: Value | Exp): value is ValuePrim {
	return (
		value === null ||
		typeof value === 'boolean' ||
		typeof value === 'number' ||
		typeof value === 'string'
	)
}

function isValueAll(value: Value): value is ValueAll {
	return !isValuePrim(value) && !Array.isArray(value) && value.type === 'all'
}

function isValueVoid(value: Value): value is ValueVoid {
	return !isValuePrim(value) && !Array.isArray(value) && value.type === 'void'
}

function isValueRestVector(value: Value): value is ValueRestVector {
	return (
		!isValuePrim(value) && !Array.isArray(value) && value.type === 'restVector'
	)
}

function isValueHashMap(value: Value): value is ValueHashMap {
	return (
		!isValuePrim(value) && !Array.isArray(value) && value.type === 'restVector'
	)
}

function isValueUnion(value: Value): value is ValueUnion {
	return !isValuePrim(value) && !Array.isArray(value) && value.type === 'union'
}

function isValueInfUnion(value: Value): value is ValueInfUnion {
	return (
		!isValuePrim(value) && !Array.isArray(value) && value.type === 'infUnion'
	)
}

function isValueFnType(value: Value): value is ValueFnType {
	return !isValuePrim(value) && !Array.isArray(value) && value.type === 'fnType'
}

function inferType(form: Form): Value {
	if (isValue(form)) {
		return form
	}

	switch (form.ast) {
		case 'value':
			return form.value
		case 'symbol':
			return inferType(resolveSymbol(form))
		case 'list': {
			const first = form.value[0]
			if (isListOf('=>', form)) {
				return inferType(evalExp(first))
			}
			return inferType(first)
		}
		case 'vector':
			return form.value.map(inferType)
		case 'hashMap':
			return createHashMap(_.mapValues(form.value, inferType))
	}
}

function clearEvaluatedRecursively(exp: Exp) {
	switch (exp.ast) {
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

function isEqualValue(a: Value, b: Value): boolean {
	if (isValuePrim(a)) {
		return a === b
	}

	if (Array.isArray(a)) {
		if (!Array.isArray(b)) {
			return false
		}
		return (
			a.length === b.length && _$.zipShorter(a, b).every(_.spread(isEqualValue))
		)
	}

	switch (a.type) {
		case 'all':
			return isValueAll(b)
		case 'void':
			return isValueVoid(b)
		case 'restVector':
			return (
				isValueRestVector(b) &&
				a.value.length === b.value.length &&
				_$.zipShorter(a.value, b.value).every(_.spread(isEqualValue))
			)
		case 'hashMap':
			return (
				isValueHashMap(b) &&
				_.xor(_.keys(a.value), _.keys(b.value)).length === 0 &&
				_.toPairs(a.value).every(([key, av]) => isEqualValue(av, b.value[key]))
			)
		case 'fn':
			return isValueFn(b) && a.body === b.body
		case 'union': {
			return (
				isValueUnion(b) &&
				a.items.length === b.items.length &&
				_.differenceWith(a.items, b.items, isEqualValue).length === 0
			)
		}
		case 'infUnion':
			return a === b
		case 'fnType':
			return (
				isValueFnType(b) &&
				isEqualValue(a.out, b.out) &&
				isEqualValue(a.params, b.params)
			)
	}
}

function resolveSymbol(sym: ExpSymbol): Exp {
	if (sym.ref) {
		return sym.ref
	}

	let ref: Exp | undefined
	let parent: Exp | undefined = sym

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

	if (!ref) {
		throw new Error(`Symbol ${printForm(sym)} is not defined`)
	}

	sym.ref = ref
	ref.dep = (ref.dep || new Set()).add(sym)

	return ref
}

export class Interpreter {
	private scope: ExpList
	private vars: ExpHashMap

	constructor() {
		this.vars = createSpecialListHashMap({})

		this.vars.value['def'] = createFn((value: Exp) => {
			if (!value.label) {
				throw new Error('no label')
			}
			this.vars.value[value.label.str] = value
			delete value.label
			value.parent = this.vars
			return value
		}, createTypeFn([TypeAll], TypeAll, {lazyEval: [true]}))

		this.scope = createList([createSymbol('let'), this.vars])
		this.scope.parent = GlobalScope
	}

	evalExp(exp: Exp): Value {
		exp.parent = this.scope
		return evalExp(exp)
	}
}

function typeCount(value: Value): number {
	if (isValuePrim(value) || Array.isArray(value)) {
		return 1
	}

	if (Array.isArray(value)) {
		return value.reduce((count, d) => count * typeCount(d), 1)
	}

	switch (value.type) {
		case 'void':
			return 0
		case 'fn':
			return 1
		case 'all':
		case 'infUnion':
		case 'restVector':
			return Infinity
		case 'hashMap':
			return _.values(value.value).reduce(
				(count: number, d) => count * typeCount(d),
				1
			)
		case 'union':
			return value.items.reduce((count: number, v) => count + typeCount(v), 0)
		case 'fnType':
			return typeCount(value.out)
	}
}

export function evalExp(exp: Exp): Value {
	return evalWithTrace(exp, [])

	function evalWithTrace(exp: Exp, trace: Exp[]): Value {
		// Check circular reference
		if (trace.includes(exp)) {
			const lastTrace = trace[trace.length - 1]
			throw new Error(`Circular reference ${printForm(lastTrace)}`)
		}
		trace = [...trace, exp]

		// Use cache
		if ('evaluated' in exp && exp.evaluated) {
			return exp.evaluated
		}

		const _eval = (e: Exp) => {
			const evaluated = evalWithTrace(e, trace)
			if (e.ast === 'list' || e.ast === 'vector' || e.ast === 'hashMap') {
				e.evaluated = evaluated
			}
			return evaluated
		}

		switch (exp.ast) {
			case 'value':
				return exp.value
			case 'symbol': {
				const ref = resolveSymbol(exp)
				return _eval(ref)
			}
			case 'list': {
				const [first, ...rest] = exp.value

				// Create Function
				/*
				if (first.ast === 'symbol' && first.value === '=>') {
					// Create a function
					const [paramsDef, bodyDef] = rest

					// Validate parameter part
					if (paramsDef.ast !== 'specialList' && paramsDef.kind !== 'vector') {
						const str = printForm(paramsDef)
						throw new Error(
							`Function parameters '${str}' must be a vector type`
						)
					}

					const paramSymbols = paramsDef.items as ExpSymbol[]

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
					const fn = (...params: Exp[]) => {
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
						rest: paramsDef.rest,
					})

					return (exp.evaluated = createFn(fn, fnType))
				} */

				const fn = _eval(first)

				let fnType: ValueFnType
				let fnBody: IFn

				if (isValueFn(fn)) {
					// Function application
					fnType = fn.fnType
					fnBody = fn.body
				} else {
					throw new Error('First element is not a function')
				}

				const params = createSpecialListVector(rest, {setParent: false})
				const assignedParams = assignExp(fnType.params, params)

				if (assignedParams.ast !== 'vector') {
					throw new Error('why??????????')
				}

				// Eval parameters at first
				const evaluatedParams = assignedParams.value.map((p, i) =>
					fnType.lazyEval && fnType.lazyEval[i] ? p : _eval(p)
				)

				const expanded = (exp.expanded = fnBody(...evaluatedParams))
				return isValue(expanded) ? expanded : _eval(expanded)
			}
			case 'vector': {
				const vec = exp.value.map(_eval)
				return exp.rest ? createVariadicVector(vec) : vec
			}
			case 'hashMap':
				return createHashMap(_.mapValues(exp.value, _eval))
		}
	}
}

function assignExp(target: Value, source: Exp): Exp {
	const sourceType = inferType(source)

	if (isValuePrim(target)) {
		if (!isEqualValue(target, sourceType)) {
			throw new Error(
				`Cannot assign '${printForm(source)}' to '${printForm(target)}'`
			)
		}
		return source
	}

	if (Array.isArray(target)) {
		if (source.ast !== 'vector' || !containsValue(target, sourceType)) {
			throw new Error(
				`Cannot assign '${printForm(source)}' to '${printForm(target)}'`
			)
		}
		return createSpecialListVector(_.take(source.value, target.length), {
			setParent: false,
		})
	}

	switch (target.type) {
		case 'all':
		case 'void':
		case 'union':
		case 'infUnion':
			if (!containsValue(target, sourceType)) {
				throw new Error(
					`Cannot assign '${printForm(source)}' to '${printForm(target)}'`
				)
			}
			return source
		case 'restVector': {
			if (
				source.ast !== 'vector' ||
				source.rest ||
				!containsValue(target, sourceType)
			) {
				throw new Error(
					`Cannot assign '${printForm(source)}' to '${printForm(target)}'`
				)
			}
			const restPos = target.value.length - 1
			const fixedPart = _.take(source.value, restPos)
			const restPart = createSpecialListVector(source.value.slice(restPos), {
				setParent: false,
			})
			return createSpecialListVector([...fixedPart, restPart], {
				setParent: false,
			})
		}
		default:
			throw new Error('Cannot assign!!!')
	}
}

// Create functions
function createVoid(): ValueVoid {
	return {type: 'void'}
}

function createSymbol(value: string): ExpSymbol {
	return {
		ast: 'symbol',
		value,
	}
}

function createFn(
	value: (...params: any[]) => Form,
	fnType: ValueFnType
): ExpValue<ValueFn> {
	return {
		ast: 'value',
		value: {
			type: 'fn',
			body: value as IFn,
			fnType,
		},
	}
}

function createList(value: Exp[], {setParent = true} = {}): ExpList {
	const exp: ExpList = {
		ast: 'list',
		value,
	}

	if (setParent) {
		value.forEach(v => (v.parent = exp))
	}

	return exp
}

function createSpecialListVector(
	value: Exp[],
	{setParent = true, rest = false} = {}
) {
	const exp: ExpVector = {
		ast: 'vector',
		value,
		rest,
	}

	if (setParent) {
		value.forEach(v => (v.parent = exp))
	}

	return exp
}

function createSpecialListHashMap(
	value: ExpHashMap['value'],
	{setParent = true} = {}
) {
	const exp: ExpHashMap = {
		ast: 'hashMap',
		value,
	}

	if (setParent) {
		_.values(value).forEach(v => (v.parent = exp))
	}

	return exp
}

function createVariadicVector(value: Value[]): ValueRestVector {
	const exp: ValueRestVector = {
		type: 'restVector',
		value,
	}

	return exp
}

function createHashMap(value: ValueHashMap['value']): ValueHashMap {
	return {
		type: 'hashMap',
		value,
	}
}

function isListOf(sym: string, exp: Exp): exp is ExpList {
	if (exp.ast === 'list') {
		const [first] = exp.value
		return first && first.ast === 'symbol' && first.value === sym
	}
	return false
}

function getName(exp: Exp): string | null {
	if (
		exp.parent?.ast === 'hashMap' &&
		exp.parent.parent &&
		isListOf('let', exp.parent.parent)
	) {
		return _.findKey(exp.parent.value, e => e === exp) || null
	}
	return null
}

export function printForm(form: Form): string {
	return isValue(form) ? printData(form) : printExp(form)

	function printExp(exp: Exp): string {
		switch (exp.ast) {
			case 'value':
				return exp.str || printData(exp.value)
			case 'symbol':
				if (exp.str) {
					return exp.str
				} else {
					const value = exp.value
					return canOmitQuote(value) ? value : '`' + value + '`'
				}
			case 'list':
				return printSeq('(', ')', exp.value, exp.delimiters)
			case 'vector': {
				const value = [...exp.value]
				const delimiters = exp.delimiters || [
					'',
					..._.times(value.length - 1, () => ' '),
					'',
				]
				if (exp.rest) {
					value.splice(-1, 0, createSymbol('...'))
					delimiters.push('')
				}
				return printSeq('[', ']', value, delimiters)
			}
			default:
				throw new Error('Invalid specialList and cannot print it')
		}
	}

	function printData(value: Value): string {
		// Print prim
		switch (value) {
			case null:
				return 'null'
			case false:
				return 'false'
			case true:
				return 'true'
		}

		switch (typeof value) {
			case 'number': {
				const str = value.toString()
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
				return value
		}

		if (Array.isArray(value)) {
			return printSeq('[', ']', value)
		}

		switch (value.type) {
			case 'all':
				return 'All'
			case 'void':
				return 'Void'
			case 'restVector': {
				const val: Form[] = [...value.value]
				const delimiters = ['', ...Array(val.length - 1).fill(' '), '', '']
				val.splice(-1, 0, createSymbol('...'))
				return printSeq('[', ']', val, delimiters)
			}
			case 'hashMap': {
				const pairs = _.entries(value.value)
				const coll = pairs.map(([label, v]) => ({
					...wrapExp(v),
					...{label: {str: label, delimiters: ['', ' ']}},
				}))
				const delimiters =
					pairs.length === 0
						? ['']
						: ['', ...Array(pairs.length - 1).fill(' '), '']
				return printSeq('{', '}', coll, delimiters)
			}
			case 'fn': {
				const params = value.fnType.params
				const out = value.fnType.out
				return `(=> ${printData(params)} ${printData(out)})`
			}
			case 'union': {
				if (value.original) {
					const name = getName(value.original)
					if (name) {
						return name
					}
				}
				const items = value.items.map(printForm).join(' ')
				return `(#| ${items})`
			}
			case 'infUnion':
				if (value.original) {
					const name = getName(value.original)
					if (name) {
						return name
					}
				}
				throw new Error('Cannot print this InfUnion')
			case 'fnType':
				return `(#=> ${printForm(value.params)} ${printForm(value.out)})`
		}
	}

	function printSeq(
		start: string,
		end: string,
		coll: Form[],
		delimiters?: string[]
	): string {
		if (delimiters) {
			if (delimiters.length === coll.length + 1) {
				return (
					start +
					coll.map((v, i) => delimiters[i] + printForm(v)).join('') +
					delimiters[delimiters.length - 1] +
					end
				)
			}
			console.warn('Invalid length of delimiters', delimiters)
		}
		return start + coll.map(printForm).join(' ') + end
	}
}
