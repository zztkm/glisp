{
	const BuiltinInfUnionTypes = window['Glisp__builtin__InfUnionTypes']
	const TypeNumber = BuiltinInfUnionTypes['Number']
	const TypeString = BuiltinInfUnionTypes['String']
}
Start = Program / BlankProgram

Program = d0:_ value:Form d1:_
	{
		return {
			ast: 'program',
			value,
			delimiters: [d0, d1]
		}
	}

BlankProgram = _ { return null }

Form =
	Void / Number / String / Symbol /
	List / Vector / HashMap

Void = "void" { return {ast: 'void'} }

// Number
Number = NumberPercentage / NumberExponential / NumberFloat / NumberHex / NumberInteger

IntegerLiteral = $(("+" / "-")? [0-9]+)

FloatLiteral = $(IntegerLiteral? "." [0-9]+)

NumberInteger = str:IntegerLiteral
	{ 
		return {
			ast: 'const',
			subsetOf: TypeNumber,
			value: parseInt(str),
			str
		}
	}

NumberFloat = str:FloatLiteral
	{
		return {
			ast: 'const',
			subsetOf: TypeNumber,
			value: parseFloat(str),
			str
		}
	}

NumberExponential = str:$((IntegerLiteral / FloatLiteral) "e" IntegerLiteral)
	{
		return {
			ast: 'const',
			subsetOf: TypeNumber,
			value: parseFloat(str),
			str
		}
	}

NumberHex = str:$("0x" [0-9a-f]i+)
	{
		return {
			ast: 'const',
			subsetOf: TypeNumber,
			value: parseInt(str),
			str
		}
	}

NumberPercentage = str:$(IntegerLiteral / FloatLiteral) "%"
	{
		return {
			ast: 'const',
			subsetOf: TypeNumber,
			value: (parseFloat(str) / 100),
			str: str + '%'
		}
	}

// String
String = value:StringLiteral
	{
		return {
			ast: 'const',
			subsetOf: TypeString,
			value
		}
	}

StringLiteral = '"' str:$(!'"' .)+ '"'
	{ return str }

Symbol = SymbolIdentifier / SymbolPath


SymbolIdentifier = str:$("#"? [a-z_+\-*/=?|<>]i [0-9a-z_+\-*/=?|<>]i*)
	{ 
		return {
			ast: 'symbol',
			value: str,
			str
		}
	}

SymbolPath = "@" str:StringLiteral
	{
		return {
			ast: 'symbol',
			value: str,
			str: `@"${str}"`
		}
	}

List = "(" d0:_ values:(Form _)* ")"
	{
		const exp = {
			ast: 'list',
			value: values.map(p => p[0]),
			delimiters: [d0, ...values.map(p => p[1])]
		}

		exp.value.forEach((e, key) => e.parent = exp)

		return exp
	}

Vector = "[" d0:_ values:(Form _)* variadic:("..." _ Form)? d2:_ "]"
	{
		const exp = {
			ast: 'specialList',
			kind: 'vector',
		}

		const value = values.map(p => p[0])
		const itemDelimiters = values.map(p => p[1])

		if (variadic) {
			const [, d1, restValue] = variadic
			exp.value = [...value, restValue]
			exp.delimiters = [d0, ...itemDelimiters, d1, d2]
			exp.variadic = true
		} else {
			exp.value = value
			exp.delimiters = [d0, ...itemDelimiters, d2]
			exp.variadic = false
		}

		exp.value.forEach((e, key) => e.parent = exp)

		return exp
	}

HashMap = "{" d0:_ pairs:((SymbolIdentifier / String) ":" _ Form _)* "}"
	{
		const value = {} // as {[key: string]: ExpForm}
		const delimiters = [d0] // as string[]

		for (const [{value: key}, colon, d1, val, d2] of pairs) {
			value[key] = val
			delimiters.push(colon + d1, d2)
		}

		const exp = {
			ast: 'specialList',
			kind: 'hashMap',
			value,
			delimiters
		}

		Object.values(exp.value).forEach(v => v.parent = exp)

		return exp
	}

_ = $([ \t\n\r]*)