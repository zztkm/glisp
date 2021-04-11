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

Form = All / Void / Null / False / True
	/ Number / String
	/ Path / Symbol / Scope / FnDef
	/ List / Vector / HashMap

All = "All"
	{
		return {
			ast: 'value',
			value: {type: 'all'}
		}
	}

Void = "Void"
	{
		return {
			ast: 'value',
			value: {type: 'void'}
		}
	}

Null = "null" { return {ast: 'value', value: null} }

False = "false" { return {ast: 'value', value: false} }

True = "true" { return {ast: 'value', value: true} }

// Number
Number = NumberInf / NumberMinusInf / NumberNan / NumberPercentage / NumberExponential / NumberFloat / NumberHex / NumberInteger

IntegerLiteral = $(("+" / "-")? [0-9]+)

FloatLiteral = $(IntegerLiteral? "." [0-9]+)

NumberInf = "Infinity" { return {ast: 'value', value: Infinity} }
NumberMinusInf = "-Infinity" { return {ast: 'value', value: -Infinity} }
NumberNan = "NaN" { return {ast: 'value', value: NaN} }

NumberInteger = str:IntegerLiteral
	{ 
		return {
			ast: 'value',
			value: parseInt(str),
			str
		}
	}

NumberFloat = str:FloatLiteral
	{
		return {
			ast: 'value',
			value: parseFloat(str),
			str
		}
	}

NumberExponential = str:$((IntegerLiteral / FloatLiteral) "e" IntegerLiteral)
	{
		return {
			ast: 'value',
			value: parseFloat(str),
			str
		}
	}

NumberHex = str:$("0x" [0-9a-f]i+)
	{
		return {
			ast: 'value',
			value: parseInt(str),
			str
		}
	}

NumberPercentage = str:$(IntegerLiteral / FloatLiteral) "%"
	{
		return {
			ast: 'value',
			value: (parseFloat(str) / 100),
			str: str + '%'
		}
	}

// String
String = '"' value:$(!'"' .)* '"'
	{
		return {
			ast: 'value',
			value
		}
	}

Symbol = SymbolIdentifier / SymbolQuoted

SymbolIdentifier = str:SymbolLiteral
	{ 
		return {
			ast: 'symbol',
			value: str,
			quoted: false
		}
	}

SymbolLiteral = $([a-z_+\-*=?|&<>@]i [0-9a-z_+\-*=?|&<>@]i*)

SymbolQuoted = '`' str:$(!'`' .)+ '`'
	{
		return {
			ast: 'symbol',
			value: str,
			quoted: true
		}
	}

Path = elements:(PathElement "/")+ last:PathElement
 {
	 return {
		 ast: 'path',
		 value: [...elements.map(e => e[0]), last]
	 }
 }

PathElement = sym:(Symbol / ".." / ".")
	{
		return typeof sym === 'string'
			? sym
			: {value: sym.value, quoted: sym.quoted}
	}

Scope = "(" d0:_ "let" d1:_ vars:HashMap d2:_ value:Form d3:_ ")"
	{
		if (value.ast === 'label') {
			throw new Error('Out form cannot be labeled')
		}

		const exp = {
			ast: 'scope',
			vars: vars.value,
			value
		}

		value.parent = exp
		Object.values(exp.vars).forEach(v => v.parent = exp)

		return exp
	}

FnDef = "(" d0:_ "=>" d1:_ params:FnDefParam d2:_ body:Form d3:_ ")"
	{
		const exp = {
			ast: 'fnDef',
			params,
			body
		}

		exp.params.items.forEach(it => it.body.parent = exp)
		if (exp.params.rest) {
			exp.params.rest.parent = exp
		}

		return exp
	}

FnDefParam = "[" d0:_ items:(Label _)* rest:("..." _ Label _)? "]"
	{
		const params = {
			items: items.map(p => p[0]),
		}

		if (rest) {
			param.rest = rest[2]
		}

		return params
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

Vector = "[" d0:_ values:(Form _)* "]"
	{
		const exp = {
			ast: 'vector',
		}

		const value = values.map(p => p[0])
		const itemDelimiters = values.map(p => p[1])

		exp.value = value
		exp.delimiters = [d0, ...itemDelimiters]

		exp.value.forEach((e, key) => e.parent = exp)

		return exp
	}

HashMap = "{" d0:_ pairs:(Label _)* "}"
	{
		const value = {} // as {[key: string]: ExpForm}
		const delimiters = [d0] // as string[]

		for (const [pair, d1] of pairs) {
			value[pair.label] = pair.body
			delimiters.push(d1)
		}

		const exp = {
			ast: 'hashMap',
			value,
			delimiters
		}

		Object.values(exp.value).forEach(v => v.parent = exp)

		return exp
	}

StringLabelLiteral = '"' value:$(!'"' .)+ '"'
 {
	 return value
 }

Label =
	label:(SymbolLiteral / StringLabelLiteral)
	d0:_ ":" d1:_
	body:Form
	{
		const exp = {
			label,
			body,
			delimiters: [d0, d1]
		}

		return exp
	}

Comment = $(";" [^\n\r]*)

Whitespace = $([ ,\t\n\r]*)

_ = w:Whitespace str:$(Comment Whitespace?)*
	{
		return w + str
	}