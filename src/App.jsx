import { useState } from 'react';
import './App.css';
import { supabase } from './supabaseClient';

// ============================================================
// PARSER: Converts an arithmetic expression into an AST
// respecting operator precedence (* / before + -)
// ============================================================

/**
 * Tokenizer — splits input into operand, operator, and parenthesis tokens.
 * Supports multi-character variable names and single-char operators.
 */
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    // Skip whitespace
    if (expr[i] === ' ') {
      i++;
      continue;
    }
    // Opening parenthesis
    if (expr[i] === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
    }
    // Closing parenthesis
    else if (expr[i] === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
    }
    // Operator
    else if ('+-*/'.includes(expr[i])) {
      tokens.push({ type: 'op', value: expr[i] });
      i++;
    }
    // Operand (variable name or number)
    else {
      let name = '';
      while (i < expr.length && !'+-*/() '.includes(expr[i])) {
        name += expr[i];
        i++;
      }
      tokens.push({ type: 'operand', value: name });
    }
  }
  return tokens;
}

/**
 * Recursive descent parser for arithmetic expressions.
 *
 * Grammar (handles precedence and parentheses):
 *   Expr   -> Term (('+' | '-') Term)*
 *   Term   -> Factor (('*' | '/') Factor)*
 *   Factor -> '(' Expr ')' | OPERAND
 */
function parseExpression(tokens) {
  let pos = 0;

  // Factor: a parenthesized expression or a single operand
  function parseFactor() {
    const token = tokens[pos];

    // Handle parenthesized sub-expression: '(' Expr ')'
    if (token && token.type === 'lparen') {
      pos++; // consume '('
      const node = parseExpr();
      // Expect closing ')'
      if (!tokens[pos] || tokens[pos].type !== 'rparen') {
        throw new Error('Missing closing parenthesis');
      }
      pos++; // consume ')'
      return node;
    }

    // Otherwise expect an operand
    if (!token || token.type !== 'operand') {
      throw new Error(`Expected operand at position ${pos}`);
    }
    pos++;
    return { type: 'operand', value: token.value };
  }

  // Term: handles * and /
  function parseTerm() {
    let left = parseFactor();
    while (pos < tokens.length && tokens[pos].type === 'op' && ('*/'.includes(tokens[pos].value))) {
      const op = tokens[pos].value;
      pos++;
      const right = parseFactor();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  // Expr: handles + and -
  function parseExpr() {
    let left = parseTerm();
    while (pos < tokens.length && tokens[pos].type === 'op' && ('+-'.includes(tokens[pos].value))) {
      const op = tokens[pos].value;
      pos++;
      const right = parseTerm();
      left = { type: 'binop', op, left, right };
    }
    return left;
  }

  const ast = parseExpr();

  // If there are leftover tokens, the expression is malformed
  if (pos < tokens.length) {
    throw new Error('Unexpected token: ' + tokens[pos].value);
  }

  return ast;
}

// ============================================================
// CODE GENERATOR: Walks the AST to produce TAC entries
// ============================================================

/**
 * Traverses the AST and generates Three Address Code instructions.
 * Each instruction: { result, op1, op, op2 }
 * Returns the list of instructions.
 */
function generateTAC(ast) {
  const instructions = [];
  let tempCount = 0;

  function walk(node) {
    // Leaf node — just return the variable name
    if (node.type === 'operand') {
      return node.value;
    }

    // Binary operation — recursively process children
    const left = walk(node.left);
    const right = walk(node.right);

    // Create a new temporary variable
    tempCount++;
    const temp = `t${tempCount}`;

    instructions.push({
      result: temp,
      op1: left,
      op: node.op,
      op2: right,
    });

    return temp;
  }

  walk(ast);
  return instructions;
}

// ============================================================
// SUPABASE: Save expression and TAC instructions to the database
// ============================================================

/**
 * Inserts the expression into the `expressions` table,
 * then inserts each TAC instruction into `tac_instructions`.
 * Runs in the background — errors are logged but don't block the UI.
 */
async function saveToSupabase(expressionText, tac) {
  try {
    // 1. Insert the expression row
    const { data: exprRow, error: exprError } = await supabase
      .from('expressions')
      .insert({
        expression: expressionText,
        instruction_count: tac.length,
      })
      .select('id')
      .single();

    if (exprError) {
      console.error('Supabase expressions insert error:', exprError);
      return;
    }

    // 2. Insert all TAC instruction rows
    const instructionRows = tac.map((instr, idx) => ({
      expression_id: exprRow.id,
      step_number: idx + 1,
      result: instr.result,
      op1: instr.op1,
      op: instr.op,
      op2: instr.op2,
    }));

    const { error: instrError } = await supabase
      .from('tac_instructions')
      .insert(instructionRows);

    if (instrError) {
      console.error('Supabase tac_instructions insert error:', instrError);
    } else {
      console.log('Saved to Supabase successfully.');
    }
  } catch (err) {
    console.error('Supabase save failed:', err);
  }
}

// ============================================================
// REACT COMPONENT
// ============================================================

function App() {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  /**
   * Handles the "Generate" button click:
   * 1. Validates input
   * 2. Tokenizes the expression
   * 3. Parses into AST (with proper precedence)
   * 4. Generates TAC instructions
   * 5. Stores result for rendering all four representations
   * 6. Saves expression + instructions to Supabase (background)
   */
  const handleGenerate = () => {
    setError('');
    setResult(null);

    const trimmed = expression.trim();
    if (!trimmed) {
      setError('Please enter an arithmetic expression.');
      return;
    }

    try {
      const tokens = tokenize(trimmed);
      const ast = parseExpression(tokens);
      const tac = generateTAC(ast);

      if (tac.length === 0) {
        setError('Expression must contain at least one operator.');
        return;
      }

      setResult({ expression: trimmed, tac });

      // Save to Supabase in the background (fire-and-forget)
      saveToSupabase(trimmed, tac);
    } catch (err) {
      setError(`Invalid expression: ${err.message}`);
    }
  };

  // Allow pressing Enter to generate
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleGenerate();
  };

  return (
    <div className="app">
      {/* ===== Team Names ===== */}
      <div className="team-names">
        <p>Smith Almeida - RA2311026010687</p>
        <p>Sumedh Sawant - RA2311026010691</p>
        <p>Aditi Onkar - RA2311026010693</p>
      </div>

      {/* ===== Header ===== */}
      <header className="header">
        <div className="header__badge">Compiler Design</div>
        <h1 className="header__title">Intermediate Code Generator</h1>
        <p className="header__subtitle">
          Generate TAC, Quadruples, Triples &amp; Indirect Triples from arithmetic expressions
        </p>
      </header>

      {/* ===== Input Section ===== */}
      <section className="input-section" id="input-section">
        <label className="input-section__label" htmlFor="expression-input">
          Enter Expression
        </label>
        <div className="input-section__row">
          <input
            id="expression-input"
            className="input-section__input"
            type="text"
            placeholder="e.g. a+b-c/d"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            id="generate-btn"
            className="input-section__btn"
            onClick={handleGenerate}
          >
            Generate
          </button>
        </div>
        {error && <div className="error" id="error-msg">{error}</div>}
      </section>

      {/* ===== Output ===== */}
      {result && (
        <div id="output-section">
          {/* Expression echo */}
          <div className="expression-echo">
            Enter expression: <span>{result.expression}</span>
          </div>

          {/* --- THREE ADDRESS CODE (TAC) --- */}
          <div className="output-card" id="tac-card">
            <div className="output-card__header">
              <div className="output-card__icon"></div>
              <div className="output-card__title">Three Address Code (TAC)</div>
            </div>
            <div className="output-card__body">
              <table className="output-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Result</th>
                    <th>:=</th>
                    <th>Op1</th>
                    <th>Op</th>
                    <th>Op2</th>
                  </tr>
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
                  <tr>
                    <th>No.</th>
                    <th>Op</th>
                    <th>Op1</th>
                    <th>Op2</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tac.map((instr, idx) => (
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
                  <tr>
                    <th>No.</th>
                    <th>Op</th>
                    <th>Op1</th>
                    <th>Op2</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tac.map((instr, idx) => {
                    // In triples, temporary variables are replaced with
                    // references to the instruction that computed them: (n)
                    const tripleRef = (operand) => {
                      if (operand.startsWith('t')) {
                        const num = parseInt(operand.slice(1), 10);
                        if (!isNaN(num)) return `(${num})`;
                      }
                      return operand;
                    };
                    return (
                      <tr key={idx}>
                        <td className="row-num">({idx + 1})</td>
                        <td className="op">{instr.op}</td>
                        <td>{tripleRef(instr.op1)}</td>
                        <td>{tripleRef(instr.op2)}</td>
                      </tr>
                    );
                  })}
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
                  <tr>
                    <th>Pointer</th>
                    <th>No.</th>
                    <th>Op</th>
                    <th>Op1</th>
                    <th>Op2</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tac.map((instr, idx) => {
                    const tripleRef = (operand) => {
                      if (operand.startsWith('t')) {
                        const num = parseInt(operand.slice(1), 10);
                        if (!isNaN(num)) return `(${num})`;
                      }
                      return operand;
                    };
                    // Pointer starts at 40 (conventional starting address)
                    return (
                      <tr key={idx}>
                        <td className="pointer">{40 + idx}</td>
                        <td className="row-num">({idx + 1})</td>
                        <td className="op">{instr.op}</td>
                        <td>{tripleRef(instr.op1)}</td>
                        <td>{tripleRef(instr.op2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== Footer ===== */}
      <footer className="footer">
        Intermediate Code Generation — Compiler Design Tool
      </footer>
    </div>
  );
}

export default App;
