import { useState } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import { tokenizeC, parseC, generateICG, optimizeTAC, generateMachineCode } from './cParser';

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

const getRegexPattern = (type) => {
  switch (type) {
    case 'PREPROCESSOR': return '#include';
    case 'HEADER': return '<[a-zA-Z]+\\.h>';
    case 'KW': return 'keyword';
    case 'ID': return '[a-zA-Z_][a-zA-Z0-9_]*';
    case 'PUNCT': return 'punctuation';
    case 'OP': return 'operator';
    case 'NUM': return '[0-9]+(\\.[0-9]+)?';
    case 'STRING': return `".*" | '.*'`;
    default: return 'unknown';
  }
};

const ASTNode = ({ node, name }) => {
  if (!node) return null;
  const isLeaf = typeof node !== 'object' || node === null;
  
  if (isLeaf) {
    return (
      <div className="ast-node ast-leaf">
        {name ? <span className="ast-key">{name}: </span> : null}
        <span className="ast-val">{String(node)}</span>
      </div>
    );
  }

  if (Array.isArray(node)) {
    return (
      <div className="ast-node">
        {name ? <span className="ast-key">{name}</span> : null}
        <div className="ast-children">
          {node.map((child, idx) => <ASTNode key={idx} node={child} />)}
        </div>
      </div>
    );
  }

  const keys = Object.keys(node).filter(k => node[k] !== undefined && node[k] !== null);
  
  return (
    <div className="ast-node">
      {name ? <span className="ast-key">{name}: </span> : null}
      <span className="ast-type">{node.type || 'Node'}</span>
      <div className="ast-children">
        {keys.map(k => {
          if (k === 'type') return null;
          return <ASTNode key={k} node={node[k]} name={k} />;
        })}
      </div>
    </div>
  );
};


function App() {
  const [codeInput, setCodeInput] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');

  const TABS = [
    'ALL', 
    'Tokens', 
    'Parse Tree', 
    'TAC', 
    'Optimized TAC', 
    'Machine Code'
  ];

  const handleGenerate = () => {
    setError('');
    setResult(null);

    const trimmed = codeInput.trim();
    if (!trimmed) { setError('Please enter C code.'); return; }
    try {
      const tokens = tokenizeC(trimmed);
      const ast = parseC(tokens);
      const tac = generateICG(ast);
      const optTac = optimizeTAC(tac);
      const machineCode = generateMachineCode(optTac);
      
      if (tac.length === 0) { setError('No instructions generated. Check your code.'); return; }
      
      setResult({ code: trimmed, tokens, ast, tac, optTac, machineCode });
      saveToSupabase(trimmed.substring(0, 200), tac);
      setActiveTab('ALL'); // Reset to ALL tab on new generation
    } catch (err) {
      setError(`Parse error: ${err.message}`);
    }
  };

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
        <h1 className="header__title">C Compiler Pipeline</h1>
        <p className="header__subtitle">
          Lexical Analysis, Parse Tree, Intermediate Code & Optimization
        </p>
      </header>

      {/* Input Section */}
      <section className="input-section" id="input-section">
        <label className="input-section__label" htmlFor="main-input">
          Enter C Code
        </label>
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
            Compile Code
          </button>
        </div>
        {error && <div className="error" id="error-msg">{error}</div>}
      </section>

      {/* Tab Navigation */}
      {result && (
        <div className="tab-nav">
          {TABS.map(tab => (
            <button 
              key={tab}
              className={`tab-nav__btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Output */}
      {result && (
        <div id="output-section">
          {activeTab === 'ALL' && (
            <div className="expression-echo">
              <span>C Code Compiled Successfully</span>
            </div>
          )}

          {/* --- SYMBOL TABLE --- */}
          {(activeTab === 'ALL' || activeTab === 'Tokens') && (
            <div className="output-card">
              <div className="output-card__header">
                <div className="output-card__icon"></div>
                <div className="output-card__title">Lexical Analysis (Tokens)</div>
              </div>
              <div className="output-card__body">
                <table className="output-table">
                  <thead>
                    <tr><th>Token Type</th><th>Lexeme</th><th>Pattern (Regex / Rule)</th></tr>
                  </thead>
                  <tbody>
                    {result.tokens.filter(t => t.type !== 'EOF').map((token, idx) => (
                      <tr key={idx}>
                        <td className="token-type">{token.type}</td>
                        <td className="lexeme">{token.value}</td>
                        <td className="pattern"><code>{getRegexPattern(token.type)}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* --- PARSE TREE (AST) --- */}
          {(activeTab === 'ALL' || activeTab === 'Parse Tree') && (
            <div className="output-card">
              <div className="output-card__header">
                <div className="output-card__icon"></div>
                <div className="output-card__title">Parse Tree (AST)</div>
              </div>
              <div className="output-card__body ast-container">
                 <ASTNode node={result.ast} />
              </div>
            </div>
          )}

          {/* --- THREE ADDRESS CODE (TAC) --- */}
          {(activeTab === 'ALL' || activeTab === 'TAC') && (
            <div className="output-card" id="tac-card">
              <div className="output-card__header">
                <div className="output-card__icon"></div>
                <div className="output-card__title">Three Address Code (TAC)</div>
              </div>
              <div className="output-card__body">
                <pre className="tac-pre">{
                  result.tac.map((instr, idx) => {
                    if (isLabel(instr)) return `    ${instr.result}`;
                    let num = 0, count = 0;
                    for (let k = 0; k <= idx; k++) { if (!isLabel(result.tac[k])) count++; }
                    num = count;
                    return `${String(num).padStart(3)}.  ${formatTACLine(instr)}`;
                  }).join('\n')
                }</pre>
              </div>
            </div>
          )}

          {/* --- QUADRUPLE --- */}
          {(activeTab === 'ALL' || activeTab === 'TAC') && (
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
          )}

          {/* --- TRIPLE --- */}
          {(activeTab === 'ALL' || activeTab === 'TAC') && (
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
          )}

          {/* --- INDIRECT TRIPLE --- */}
          {(activeTab === 'ALL' || activeTab === 'TAC') && (
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
          )}

          {/* --- OPTIMIZED TAC --- */}
          {(activeTab === 'ALL' || activeTab === 'Optimized TAC') && (
            <div className="output-card">
              <div className="output-card__header">
                <div className="output-card__icon" style={{backgroundColor: '#10b981'}}></div>
                <div className="output-card__title">Optimized Three Address Code</div>
              </div>
              <div className="output-card__body">
                <pre className="tac-pre">{
                  result.optTac.map((instr, idx) => {
                    if (isLabel(instr)) return `    ${instr.result}`;
                    let num = 0, count = 0;
                    for (let k = 0; k <= idx; k++) { if (!isLabel(result.optTac[k])) count++; }
                    num = count;
                    return `${String(num).padStart(3)}.  ${formatTACLine(instr)}`;
                  }).join('\n')
                }</pre>
              </div>
            </div>
          )}

          {/* --- MACHINE CODE --- */}
          {(activeTab === 'ALL' || activeTab === 'Machine Code') && (
            <div className="output-card">
              <div className="output-card__header">
                <div className="output-card__icon"></div>
                <div className="output-card__title">Machine Instruction Code</div>
              </div>
              <div className="output-card__body">
                <pre className="tac-pre">{
                  result.machineCode.join('\n')
                }</pre>
              </div>
            </div>
          )}
          
        </div>
      )}

      <footer className="footer">
        C Compiler Pipeline — Compiler Design Tool
      </footer>
    </div>
  );
}

export default App;
