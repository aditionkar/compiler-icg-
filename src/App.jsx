import { useState } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import { tokenizeC, parseC, generateICG } from './cParser';


function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === ' ') { i++; continue; }
    if (expr[i] === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; }
    else if (expr[i] === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; }
    else if ('+-*/'.includes(expr[i])) { tokens.push({ type: 'op', value: expr[i] }); i++; }
    else {
      let name = '';
      while (i < expr.length && !'+-*/() '.includes(expr[i])) { name += expr[i]; i++; }
      tokens.push({ type: 'operand', value: name });
    }
  }
  return tokens;
}

function parseExpression(tokens) {
  let pos = 0;
  function parseFactor() {
    const token = tokens[pos];
    if (token && token.type === 'lparen') {
      pos++;
      const node = parseExpr();
      if (!tokens[pos] || tokens[pos].type !== 'rparen') throw new Error('Missing closing parenthesis');
      pos++;
      return node;
    }
    if (!token || token.type !== 'operand') throw new Error(`Expected operand at position ${pos}`);
    pos++;
    return { type: 'operand', value: token.value };
  }
  function parseTerm() {
    let left = parseFactor();
    while (pos < tokens.length && tokens[pos].type === 'op' && '*/'.includes(tokens[pos].value)) {
      const op = tokens[pos].value; pos++;
      left = { type: 'binop', op, left, right: parseFactor() };
    }
    return left;
  }
  function parseExpr() {
    let left = parseTerm();
    while (pos < tokens.length && tokens[pos].type === 'op' && '+-'.includes(tokens[pos].value)) {
      const op = tokens[pos].value; pos++;
      left = { type: 'binop', op, left, right: parseTerm() };
    }
    return left;
  }
  const ast = parseExpr();
  if (pos < tokens.length) throw new Error('Unexpected token: ' + tokens[pos].value);
  return ast;
}

function generateTAC(ast) {
  const instructions = [];
  let tempCount = 0;
  function walk(node) {
    if (node.type === 'operand') return node.value;
    const left = walk(node.left);
    const right = walk(node.right);
    tempCount++;
    const temp = `t${tempCount}`;
    instructions.push({ result: temp, op1: left, op: node.op, op2: right });
    return temp;
  }
  walk(ast);
  return instructions;
}


async function saveToSupabase(expressionText, tac) {
  try {
    const { data: exprRow, error: exprError } = await supabase
      .from('expressions')
      .insert({ expression: expressionText, instruction_count: tac.length })
      .select('id')
      .single();
    if (exprError) { console.error('Supabase expressions insert error:', exprError); return; }

    const instructionRows = tac.map((instr, idx) => ({
      expression_id: exprRow.id,
      step_number: idx + 1,
      result: instr.result || '',
      op1: instr.op1 || '',
      op: instr.op || '',
      op2: instr.op2 || '',
    }));
    const { error: instrError } = await supabase.from('tac_instructions').insert(instructionRows);
    if (instrError) console.error('Supabase tac_instructions insert error:', instrError);
    else console.log('Saved to Supabase successfully.');
  } catch (err) {
    console.error('Supabase save failed:', err);
  }
}


// Check if an instruction is a "label" row (e.g. result is "L0:")
function isLabel(instr) {
  return instr.result && instr.result.endsWith(':') && !instr.op && !instr.op1;
}

// Check if an instruction is a control-flow instruction
function isControl(instr) {
  return ['goto', 'if_false', 'param', 'call', 'return'].includes(instr.op);
}

// For triple references: replace temp vars (t1, t2...) with (n) references
function tripleRef(operand, tempMap) {
  if (!operand) return '';
  if (tempMap && tempMap[operand] !== undefined) return `(${tempMap[operand]})`;
  return operand;
}

// Build a mapping of temp variable name → instruction number (1-based)
function buildTempMap(tac) {
  const map = {};
  let num = 1;
  tac.forEach(instr => {
    if (!isLabel(instr)) {
      if (instr.result && instr.result.startsWith('t') && !instr.result.endsWith(':')) {
        map[instr.result] = num;
      }
      num++;
    }
  });
  return map;
}

// Format a TAC instruction as a readable string
function formatTACLine(instr) {
  if (isLabel(instr)) return instr.result;
  if (instr.op === 'goto') return `goto ${instr.op1}`;
  if (instr.op === 'if_false') return `if_false ${instr.op1} goto ${instr.op2}`;
  if (instr.op === 'param') return `param ${instr.op1}`;
  if (instr.op === 'call') return `${instr.result ? instr.result + ' := ' : ''}call ${instr.op1}, ${instr.op2}`;
  if (instr.op === 'return') return `return ${instr.op1}`;
  if (instr.op === ':=') return `${instr.result} := ${instr.op1}`;
  if (instr.op && instr.op2) return `${instr.result} := ${instr.op1} ${instr.op} ${instr.op2}`;
  if (instr.op && !instr.op2) return `${instr.result} := ${instr.op}${instr.op1}`;
  return `${instr.result} := ${instr.op1}`;
}



function App() {
  const [mode, setMode] = useState('expression'); // 'expression' or 'code'
  const [expression, setExpression] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleGenerate = () => {
    setError('');
    setResult(null);

    if (mode === 'expression') {
      const trimmed = expression.trim();
      if (!trimmed) { setError('Please enter an arithmetic expression.'); return; }
      try {
        const tokens = tokenize(trimmed);
        const ast = parseExpression(tokens);
        const tac = generateTAC(ast);
        if (tac.length === 0) { setError('Expression must contain at least one operator.'); return; }
        setResult({ expression: trimmed, tac, mode: 'expression' });
        saveToSupabase(trimmed, tac);
      } catch (err) {
        setError(`Invalid expression: ${err.message}`);
      }
    } else {
      const trimmed = codeInput.trim();
      if (!trimmed) { setError('Please enter C code.'); return; }
      try {
        const tokens = tokenizeC(trimmed);
        const ast = parseC(tokens);
        const tac = generateICG(ast);
        if (tac.length === 0) { setError('No instructions generated. Check your code.'); return; }
        setResult({ expression: trimmed, tac, mode: 'code' });
        saveToSupabase(trimmed.substring(0, 200), tac);
      } catch (err) {
        setError(`Parse error: ${err.message}`);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && mode === 'expression') handleGenerate();
  };

  // Filter out label rows for quadruple/triple/indirect triple display
  const nonLabelTac = result ? result.tac.filter(i => !isLabel(i)) : [];
  const tempMap = result ? buildTempMap(result.tac) : {};

  return (
    <div className="app">
      {/* Team Names */}
      <div className="team-names">
        <p>Kishore Ram - RA2311026010685</p>
        <p>Smith Almeida - RA2311026010687</p>
        <p>Sumedh Sawant - RA2311026010691</p>
        <p>Aditi Onkar - RA2311026010693</p>
      </div>

      {/* Header */}
      <header className="header">
        <div className="header__badge">Compiler Design</div>
        <h1 className="header__title">Intermediate Code Generator</h1>
        <p className="header__subtitle">
          Generate TAC, Quadruples, Triples &amp; Indirect Triples
        </p>
      </header>

      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button
          className={`mode-toggle__btn ${mode === 'expression' ? 'active' : ''}`}
          onClick={() => { setMode('expression'); setResult(null); setError(''); }}
        >
          Expression
        </button>
        <button
          className={`mode-toggle__btn ${mode === 'code' ? 'active' : ''}`}
          onClick={() => { setMode('code'); setResult(null); setError(''); }}
        >
          C Code
        </button>
      </div>

      {/* Input Section */}
      <section className="input-section" id="input-section">
        <label className="input-section__label" htmlFor="main-input">
          {mode === 'expression' ? 'Enter Expression' : 'Enter C Code'}
        </label>

        {mode === 'expression' ? (
          <div className="input-section__row">
            <input
              id="main-input"
              className="input-section__input"
              type="text"
              placeholder="e.g. a+b-c/d"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button id="generate-btn" className="input-section__btn" onClick={handleGenerate}>
              Generate
            </button>
          </div>
        ) : (
          <div className="input-section__col">
            <textarea
              id="main-input"
              className="input-section__textarea"
              placeholder={"#include <stdio.h>\nint main() {\n    // paste C code here\n    return 0;\n}"}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              rows={12}
            />
            <button id="generate-btn" className="input-section__btn input-section__btn--full" onClick={handleGenerate}>
              Generate
            </button>
          </div>
        )}
        {error && <div className="error" id="error-msg">{error}</div>}
      </section>

      {/* Output */}
      {result && (
        <div id="output-section">
          <div className="expression-echo">
            {result.mode === 'expression'
              ? <>Enter expression: <span>{result.expression}</span></>
              : <span>C Code — {nonLabelTac.length} instructions generated</span>}
          </div>

          {/* --- THREE ADDRESS CODE (TAC) --- */}
          <div className="output-card" id="tac-card">
            <div className="output-card__header">
              <div className="output-card__icon"></div>
              <div className="output-card__title">Three Address Code (TAC)</div>
            </div>
            <div className="output-card__body">
              {result.mode === 'expression' ? (
                <table className="output-table">
                  <thead>
                    <tr><th>No.</th><th>Result</th><th>:=</th><th>Op1</th><th>Op</th><th>Op2</th></tr>
                  </thead>
                  <tbody>
                    {result.tac.map((instr, idx) => (
                      <tr key={idx}>
                        <td className="row-num">{idx + 1}.</td>
                        <td className="result">{instr.result}</td>
                        <td>:=</td>
                        <td>{instr.op1}</td>
                        <td className="op">{instr.op}</td>
                        <td>{instr.op2}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre className="tac-pre">{
                  result.tac.map((instr, idx) => {
                    if (isLabel(instr)) return `    ${instr.result}`;
                    // Number only non-label lines
                    let num = 0, count = 0;
                    for (let k = 0; k <= idx; k++) { if (!isLabel(result.tac[k])) count++; }
                    num = count;
                    return `${String(num).padStart(3)}.  ${formatTACLine(instr)}`;
                  }).join('\n')
                }</pre>
              )}
            </div>
          </div>

          {/* --- QUADRUPLE --- */}
          <div className="output-card" id="quadruple-card">
            <div className="output-card__header">
              <div className="output-card__icon"></div>
              <div className="output-card__title">Quadruple</div>
            </div>
            <div className="output-card__body">
              <table className="output-table">
                <thead>
                  <tr><th>No.</th><th>Op</th><th>Arg1</th><th>Arg2</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {nonLabelTac.map((instr, idx) => (
                    <tr key={idx}>
                      <td className="row-num">({idx + 1})</td>
                      <td className="op">{instr.op}</td>
                      <td>{instr.op1}</td>
                      <td>{instr.op2}</td>
                      <td className="result">{instr.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* --- TRIPLE --- */}
          <div className="output-card" id="triple-card">
            <div className="output-card__header">
              <div className="output-card__icon"></div>
              <div className="output-card__title">Triple</div>
            </div>
            <div className="output-card__body">
              <table className="output-table">
                <thead>
                  <tr><th>No.</th><th>Op</th><th>Arg1</th><th>Arg2</th></tr>
                </thead>
                <tbody>
                  {nonLabelTac.map((instr, idx) => (
                    <tr key={idx}>
                      <td className="row-num">({idx + 1})</td>
                      <td className="op">{instr.op}</td>
                      <td>{tripleRef(instr.op1, tempMap)}</td>
                      <td>{tripleRef(instr.op2, tempMap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* --- INDIRECT TRIPLE --- */}
          <div className="output-card" id="indirect-triple-card">
            <div className="output-card__header">
              <div className="output-card__icon"></div>
              <div className="output-card__title">Indirect Triple</div>
            </div>
            <div className="output-card__body">
              <table className="output-table">
                <thead>
                  <tr><th>Pointer</th><th>No.</th><th>Op</th><th>Arg1</th><th>Arg2</th></tr>
                </thead>
                <tbody>
                  {nonLabelTac.map((instr, idx) => (
                    <tr key={idx}>
                      <td className="pointer">{40 + idx}</td>
                      <td className="row-num">({idx + 1})</td>
                      <td className="op">{instr.op}</td>
                      <td>{tripleRef(instr.op1, tempMap)}</td>
                      <td>{tripleRef(instr.op2, tempMap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        Intermediate Code Generation — Compiler Design Tool
      </footer>
    </div>
  );
}

export default App;
