import {
	MalVal,
	MalAtom,
	isMalFunc,
	isKeyword,
	isSymbol,
	symbolFor as S,
	M_PARAMS,
	M_AST,
	isMap,
	isList,
	isVector,
	M_ISMACRO
} from './types'

const S_QUOTE = S('quote'),
	S_QUASIQUOTE = S('quasiquote'),
	S_UNQUOTE = S('unquote'),
	S_SPLICE_UNQUOTE = S('splice-unquote')

export const printer = {
	log: (...args: any) => {
		console.info(...args)
	},
	return: (...args: any) => {
		console.log(...args)
	},
	error: (...args: any) => {
		console.error(...args)
	},
	clear: console.clear
}

export default function printExp(
	exp: MalVal,
	printReadably = true,
	cache = false
): string {
	const _r = printReadably
	const _c = cache

	let ret

	if (isList(exp)) {
		if (exp.length === 2) {
			switch (exp[0]) {
				case S_QUOTE:
					ret = "'" + printExp(exp[1], _r, _c)
					break
				case S_QUASIQUOTE:
					ret = '`' + printExp(exp[1], _r, _c)
					break
				case S_UNQUOTE:
					ret = '~' + printExp(exp[1], _r, _c)
					break
				case S_SPLICE_UNQUOTE:
					ret = '~@' + printExp(exp[1], _r, _c)
					break
				default:
					ret = '(' + exp.map(e => printExp(e, _r, _c)).join(' ') + ')'
					break
			}
		} else {
			ret = '(' + exp.map(e => printExp(e, _r, _c)).join(' ') + ')'
		}
	} else if (isVector(exp)) {
		ret = '[' + exp.map(e => printExp(e, _r, _c)).join(' ') + ']'
	} else if (isMap(exp)) {
		const maps = []
		for (const k in exp) {
			maps.push(printExp(k, _r, _c), printExp(exp[k], _r, _c))
		}
		ret = '{' + maps.join(' ') + '}'
	} else if (typeof exp === 'string') {
		if (isSymbol(exp)) {
			ret = exp.slice(1)
		} else if (isKeyword(exp)) {
			ret = ':' + (exp as string).slice(1)
		} else if (_r) {
			ret =
				'"' +
				(exp as string)
					.replace(/\\/g, '\\\\')
					.replace(/"/g, '\\"')
					.replace(/\n/g, '\\n') +
				'"'
		} else {
			ret = exp
		}
	} else if (exp === null) {
		ret = 'nil'
	} else if (isMalFunc(exp)) {
		const params = printExp(exp[M_PARAMS], _r, _c)
		const body = printExp(exp[M_AST], _r, _c)
		ret = `(${exp[M_ISMACRO] ? 'macro' : 'fn'} ${params} ${body})`
	} else if (typeof exp === 'number' || typeof exp === 'boolean') {
		ret = exp.toString()
	} else if (exp instanceof MalAtom) {
		ret = '(atom ' + printExp(exp.val, _r, _c) + ')'
	} else if (typeof exp === 'function') {
		ret = exp.toString()
	} else if (exp === undefined) {
		ret = '<undefined>'
	} else {
		ret = `<${exp.constructor.name}>`
	}

	return ret
}
