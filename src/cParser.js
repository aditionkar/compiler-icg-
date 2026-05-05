
const KEYWORDS = new Set([
  'int','float','char','double','void','for','while','do',
  'if','else','return','printf','main','include','stdio'
]);

function tokenizeC(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    if (/\s/.test(code[i])) { i++; continue; }
    // Preprocessor and Header
    if (code[i] === '#') {
      let start = i;
      while (i < code.length && code[i] !== '\n') i++;
      let line = code.slice(start, i).trim();
      if (line.startsWith('#include')) {
        tokens.push({ type: 'PREPROCESSOR', value: '#include' });
        let header = line.slice(8).trim();
        if (header) {
          tokens.push({ type: 'HEADER', value: header });
        }
      }
      continue;
    }
    // Skip // comments
    if (code[i] === '/' && code[i+1] === '/') { while (i < code.length && code[i] !== '\n') i++; continue; }
    // Skip /* */ comments
    if (code[i] === '/' && code[i+1] === '*') { i+=2; while (i<code.length-1 && !(code[i]==='*'&&code[i+1]==='/')) i++; i+=2; continue; }
    // String literal
    if (code[i] === '"') {
      let s = ''; i++;
      while (i < code.length && code[i] !== '"') {
        if (code[i] === '\\') { s += code[i]+code[i+1]; i+=2; } else { s += code[i]; i++; }
      }
      i++; tokens.push({ type: 'STRING', value: `"${s}"` }); continue;
    }
    // Char literal
    if (code[i] === "'") {
      let s = ''; i++;
      while (i < code.length && code[i] !== "'") { s += code[i]; i++; }
      i++; tokens.push({ type: 'STRING', value: `'${s}'` }); continue;
    }
    // Number
    if (/\d/.test(code[i])) {
      let n = '';
      while (i < code.length && /[\d.]/.test(code[i])) { n += code[i]; i++; }
      tokens.push({ type: 'NUM', value: n }); continue;
    }
    // Identifier / keyword
    if (/[a-zA-Z_]/.test(code[i])) {
      let id = '';
      while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) { id += code[i]; i++; }
      tokens.push({ type: KEYWORDS.has(id) ? 'KW' : 'ID', value: id }); continue;
    }
    // Two-char operators
    const two = code.slice(i, i+2);
    if (['==','!=','<=','>=','++','--','&&','||','+=','-=','*=','/=','%='].includes(two)) {
      tokens.push({ type: 'OP', value: two }); i+=2; continue;
    }
    // Single-char operators
    if ('+-*/%=<>!&|'.includes(code[i])) {
      tokens.push({ type: 'OP', value: code[i] }); i++; continue;
    }
    // Punctuation
    if ('(){};,.'.includes(code[i])) {
      tokens.push({ type: 'PUNCT', value: code[i] }); i++; continue;
    }
    i++; // skip unknown
  }
  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}


function parseC(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const at = (type, value) => { const t = peek(); return t && t.type === type && (value === undefined || t.value === value); };
  const eat = (type, value) => {
    if (at(type, value)) return tokens[pos++];
    const t = peek();
    throw new Error(`Expected ${type} ${value||''} but got ${t?t.type:''} ${t?t.value:''}`);
  };
  const maybe = (type, value) => { if (at(type, value)) return tokens[pos++]; return null; };

  function parseProgram() {
    const stmts = [];
    // Skip to main body or parse top-level statements
    while (!at('EOF')) {
      if (at('KW','include') || at('KW','stdio') || at('PREPROCESSOR') || at('HEADER')) { pos++; continue; }
      if (at('PUNCT','<')) { while (!at('PUNCT','>') && !at('EOF')) pos++; maybe('PUNCT','>'); continue; }
      if (at('KW','int') || at('KW','void') || at('KW','float') || at('KW','char') || at('KW','double')) {
        const saved = pos;
        pos++;
        if (at('KW','main')) {
          pos++; maybe('PUNCT','('); maybe('PUNCT',')');
          const body = parseBlock();
          stmts.push(...body);
          continue;
        }
        pos = saved;
      }
      stmts.push(parseStatement());
    }
    return stmts;
  }

  function parseBlock() {
    eat('PUNCT', '{');
    const stmts = [];
    while (!at('PUNCT', '}') && !at('EOF')) {
      stmts.push(parseStatement());
    }
    eat('PUNCT', '}');
    return stmts;
  }

  function parseStatement() {
    // Declaration: int i, j, n = 5;
    if (at('KW','int') || at('KW','float') || at('KW','char') || at('KW','double')) {
      return parseDeclaration();
    }
    // For loop
    if (at('KW','for')) return parseFor();
    // While loop
    if (at('KW','while')) return parseWhile();
    // If/else
    if (at('KW','if')) return parseIf();
    // Return
    if (at('KW','return')) return parseReturn();
    // Printf
    if (at('KW','printf')) return parsePrintf();
    // Block
    if (at('PUNCT','{')) {
      const body = parseBlock();
      return { type: 'block', body };
    }
    // Expression statement
    const expr = parseExpr();
    maybe('PUNCT', ';');
    return { type: 'expr_stmt', expr };
  }

  function parseDeclaration() {
    pos++; // skip type keyword
    const decls = [];
    do {
      const name = eat('ID').value;
      let init = null;
      if (maybe('OP', '=')) {
        init = parseExpr();
      }
      decls.push({ name, init });
    } while (maybe('PUNCT', ','));
    maybe('PUNCT', ';');
    return { type: 'decl', decls };
  }

  function parseFor() {
    eat('KW', 'for');
    eat('PUNCT', '(');
    // init - could be a declaration or expression
    let init;
    if (at('KW','int') || at('KW','float') || at('KW','char') || at('KW','double')) {
      init = parseDeclaration();
    } else {
      init = parseExpr();
      maybe('PUNCT', ';');
    }
    const cond = parseExpr();
    maybe('PUNCT', ';');
    const update = parseExpr();
    eat('PUNCT', ')');
    let body;
    if (at('PUNCT', '{')) {
      body = { type: 'block', body: parseBlock() };
    } else {
      body = parseStatement();
    }
    return { type: 'for', init, cond, update, body };
  }

  function parseWhile() {
    eat('KW', 'while');
    eat('PUNCT', '(');
    const cond = parseExpr();
    eat('PUNCT', ')');
    let body;
    if (at('PUNCT', '{')) {
      body = { type: 'block', body: parseBlock() };
    } else {
      body = parseStatement();
    }
    return { type: 'while', cond, body };
  }

  function parseIf() {
    eat('KW', 'if');
    eat('PUNCT', '(');
    const cond = parseExpr();
    eat('PUNCT', ')');
    let then;
    if (at('PUNCT', '{')) {
      then = { type: 'block', body: parseBlock() };
    } else {
      then = parseStatement();
    }
    let elseBody = null;
    if (maybe('KW', 'else')) {
      if (at('PUNCT', '{')) {
        elseBody = { type: 'block', body: parseBlock() };
      } else {
        elseBody = parseStatement();
      }
    }
    return { type: 'if', cond, then, else: elseBody };
  }

  function parseReturn() {
    eat('KW', 'return');
    let value = null;
    if (!at('PUNCT', ';')) {
      value = parseExpr();
    }
    maybe('PUNCT', ';');
    return { type: 'return', value };
  }

  function parsePrintf() {
    eat('KW', 'printf');
    eat('PUNCT', '(');
    const args = [];
    args.push(parseExpr());
    while (maybe('PUNCT', ',')) {
      args.push(parseExpr());
    }
    eat('PUNCT', ')');
    maybe('PUNCT', ';');
    return { type: 'printf', args };
  }

  // Expression parsing with precedence
  function parseExpr() { return parseAssign(); }

  function parseAssign() {
    let left = parseOr();
    if (at('OP','=') || at('OP','+=') || at('OP','-=') || at('OP','*=') || at('OP','/=') || at('OP','%=')) {
      const op = tokens[pos++].value;
      const right = parseAssign();
      return { type: 'assign', op, left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (maybe('OP', '||')) { left = { type: 'binop', op: '||', left, right: parseAnd() }; }
    return left;
  }

  function parseAnd() {
    let left = parseEquality();
    while (maybe('OP', '&&')) { left = { type: 'binop', op: '&&', left, right: parseEquality() }; }
    return left;
  }

  function parseEquality() {
    let left = parseRelational();
    while (at('OP','==') || at('OP','!=')) {
      const op = tokens[pos++].value;
      left = { type: 'binop', op, left, right: parseRelational() };
    }
    return left;
  }

  function parseRelational() {
    let left = parseAdditive();
    while (at('OP','<') || at('OP','>') || at('OP','<=') || at('OP','>=')) {
      const op = tokens[pos++].value;
      left = { type: 'binop', op, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (at('OP','+') || at('OP','-')) {
      const op = tokens[pos++].value;
      left = { type: 'binop', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (at('OP','*') || at('OP','/') || at('OP','%')) {
      const op = tokens[pos++].value;
      left = { type: 'binop', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (at('OP','!')) { pos++; return { type: 'unary', op: '!', operand: parseUnary() }; }
    if (at('OP','-') && !(tokens[pos-1] && (tokens[pos-1].type==='NUM'||tokens[pos-1].type==='ID'||tokens[pos-1].value===')'))) {
      pos++; return { type: 'unary', op: '-', operand: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    while (at('OP','++') || at('OP','--')) {
      const op = tokens[pos++].value;
      node = { type: 'postfix', op, operand: node };
    }
    return node;
  }

  function parsePrimary() {
    // Parenthesized expression
    if (at('PUNCT', '(')) {
      pos++;
      const expr = parseExpr();
      eat('PUNCT', ')');
      return expr;
    }
    // Number literal
    if (at('NUM')) { return { type: 'literal', value: tokens[pos++].value }; }
    // String literal
    if (at('STRING')) { return { type: 'string', value: tokens[pos++].value }; }
    // Identifier
    if (at('ID')) {
      const name = tokens[pos++].value;
      // Function call
      if (at('PUNCT', '(')) {
        pos++;
        const args = [];
        if (!at('PUNCT', ')')) {
          args.push(parseExpr());
          while (maybe('PUNCT', ',')) args.push(parseExpr());
        }
        eat('PUNCT', ')');
        return { type: 'call', name, args };
      }
      return { type: 'ident', name };
    }
    // If nothing matches, skip token and return a dummy
    const t = tokens[pos++];
    return { type: 'literal', value: t ? t.value : '?' };
  }

  return parseProgram();
}


function generateICG(stmts) {
  const instrs = []; // Each: { result, op, op1, op2 } — unified format
  let tempCount = 0;
  let labelCount = 0;

  function newTemp() { return `t${++tempCount}`; }
  function newLabel() { return `L${labelCount++}`; }

  // Add a standard expression instruction
  function emit(result, op, op1, op2) {
    instrs.push({ result: result || '', op: op || '', op1: op1 || '', op2: op2 || '' });
  }

  // Evaluate an expression AST node, return the place (variable/temp) holding the value
  function evalExpr(node) {
    if (!node) return '';

    if (node.type === 'literal' || node.type === 'string') return node.value;
    if (node.type === 'ident') return node.name;

    if (node.type === 'binop') {
      const l = evalExpr(node.left);
      const r = evalExpr(node.right);
      const t = newTemp();
      emit(t, node.op, l, r);
      return t;
    }

    if (node.type === 'unary') {
      const operand = evalExpr(node.operand);
      const t = newTemp();
      emit(t, node.op, operand, '');
      return t;
    }

    if (node.type === 'postfix') {
      // i++ → t = i + 1, i = t (but return old value — simplified for ICG)
      const operand = evalExpr(node.operand);
      const t = newTemp();
      const incOp = node.op === '++' ? '+' : '-';
      emit(t, incOp, operand, '1');
      const varName = node.operand.type === 'ident' ? node.operand.name : operand;
      emit(varName, ':=', t, '');
      return varName;
    }

    if (node.type === 'assign') {
      const varName = node.left.type === 'ident' ? node.left.name : evalExpr(node.left);
      if (node.op === '=') {
        const val = evalExpr(node.right);
        emit(varName, ':=', val, '');
        return varName;
      }
      // Compound assignment: +=, -=, *=, /=, %=
      const baseOp = node.op[0]; // + from +=
      const r = evalExpr(node.right);
      const t = newTemp();
      emit(t, baseOp, varName, r);
      emit(varName, ':=', t, '');
      return varName;
    }

    if (node.type === 'call') {
      const evaluatedArgs = node.args.map(a => evalExpr(a));
      evaluatedArgs.forEach(a => emit('', 'param', a, ''));
      const t = newTemp();
      emit(t, 'call', node.name, String(evaluatedArgs.length));
      return t;
    }

    return node.value || '?';
  }

  function genStmt(stmt) {
    if (!stmt) return;

    if (stmt.type === 'block') {
      stmt.body.forEach(s => genStmt(s));
      return;
    }

    if (stmt.type === 'decl') {
      stmt.decls.forEach(d => {
        if (d.init) {
          const val = evalExpr(d.init);
          emit(d.name, ':=', val, '');
        }
      });
      return;
    }

    if (stmt.type === 'expr_stmt') {
      evalExpr(stmt.expr);
      return;
    }

    if (stmt.type === 'for') {
      // init
      if (stmt.init.type === 'decl') genStmt(stmt.init);
      else evalExpr(stmt.init);

      const startLabel = newLabel();
      const endLabel = newLabel();

      // L_start:
      emit(startLabel + ':', '', '', '');
      // condition
      const cond = evalExpr(stmt.cond);
      emit('', 'if_false', cond, endLabel);

      // body
      genStmt(stmt.body);

      // update
      evalExpr(stmt.update);

      // goto L_start
      emit('', 'goto', startLabel, '');
      // L_end:
      emit(endLabel + ':', '', '', '');
      return;
    }

    if (stmt.type === 'while') {
      const startLabel = newLabel();
      const endLabel = newLabel();
      emit(startLabel + ':', '', '', '');
      const cond = evalExpr(stmt.cond);
      emit('', 'if_false', cond, endLabel);
      genStmt(stmt.body);
      emit('', 'goto', startLabel, '');
      emit(endLabel + ':', '', '', '');
      return;
    }

    if (stmt.type === 'if') {
      const cond = evalExpr(stmt.cond);
      if (stmt.else) {
        const elseLabel = newLabel();
        const endLabel = newLabel();
        emit('', 'if_false', cond, elseLabel);
        genStmt(stmt.then);
        emit('', 'goto', endLabel, '');
        emit(elseLabel + ':', '', '', '');
        genStmt(stmt.else);
        emit(endLabel + ':', '', '', '');
      } else {
        const endLabel = newLabel();
        emit('', 'if_false', cond, endLabel);
        genStmt(stmt.then);
        emit(endLabel + ':', '', '', '');
      }
      return;
    }

    if (stmt.type === 'printf') {
      const evaluatedArgs = stmt.args.map(a => evalExpr(a));
      
      if (evaluatedArgs.length > 0 && typeof evaluatedArgs[0] === 'string' && evaluatedArgs[0].startsWith('"')) {
        const matches = evaluatedArgs[0].match(/%[0-9]*[a-zA-Z]/g);
        if (matches) {
          evaluatedArgs[0] = `"${matches.join(' ')}"`;
        }
      }

      evaluatedArgs.forEach(a => emit('', 'param', a, ''));
      emit('', 'call', 'printf', String(evaluatedArgs.length));
      return;
    }

    if (stmt.type === 'return') {
      if (stmt.value) {
        const val = evalExpr(stmt.value);
        emit('', 'return', val, '');
      } else {
        emit('', 'return', '', '');
      }
      return;
    }
  }

  stmts.forEach(s => genStmt(s));
  return instrs;
}

function optimizeTAC(tac) {
  let optimized = JSON.parse(JSON.stringify(tac)); // deep copy
  let changed = true;
  while (changed) {
    changed = false;
    
    // 0. Copy Propagation
    const aliases = {};
    for (let i = 0; i < optimized.length; i++) {
      let instr = optimized[i];
      if (aliases[instr.op1] !== undefined) instr.op1 = aliases[instr.op1];
      if (aliases[instr.op2] !== undefined) instr.op2 = aliases[instr.op2];
      
      if (instr.op === ':=' && instr.result && instr.result.startsWith('t') && !instr.result.endsWith(':') && instr.op1 && !instr.op2 && isNaN(instr.op1)) {
          aliases[instr.result] = instr.op1;
      }
      
      if (instr.result && !instr.result.startsWith('t') && instr.op === ':=') { 
          for (let key in aliases) {
              if (aliases[key] === instr.result) delete aliases[key];
          }
      }
    }
    
    // 1. Constant Folding & Propagation
    const constants = {}; // result -> value
    for (let i = 0; i < optimized.length; i++) {
      let instr = optimized[i];
      // Propagate constants
      if (constants[instr.op1] !== undefined) instr.op1 = constants[instr.op1];
      if (constants[instr.op2] !== undefined) instr.op2 = constants[instr.op2];
      
      // Constant folding
      if (['+', '-', '*', '/'].includes(instr.op) && !isNaN(instr.op1) && !isNaN(instr.op2) && instr.op1 !== '' && instr.op2 !== '') {
        let val;
        switch(instr.op) {
          case '+': val = Number(instr.op1) + Number(instr.op2); break;
          case '-': val = Number(instr.op1) - Number(instr.op2); break;
          case '*': val = Number(instr.op1) * Number(instr.op2); break;
          case '/': val = Number(instr.op1) / Number(instr.op2); break;
        }
        instr.op = ':=';
        instr.op1 = String(val);
        instr.op2 = '';
        changed = true;
      }
      
      // Track constants
      if (instr.op === ':=' && !isNaN(instr.op1) && instr.op1 !== '') {
        constants[instr.result] = instr.op1;
      } else if (instr.result) {
        delete constants[instr.result]; // invalidate
      }
    }
    
    // 2. Algebraic simplification
    for (let i = 0; i < optimized.length; i++) {
        let instr = optimized[i];
        if (instr.op === '+' && instr.op2 === '0') { instr.op = ':='; instr.op2 = ''; changed = true; }
        else if (instr.op === '+' && instr.op1 === '0') { instr.op = ':='; instr.op1 = instr.op2; instr.op2 = ''; changed = true; }
        else if (instr.op === '*' && instr.op2 === '1') { instr.op = ':='; instr.op2 = ''; changed = true; }
        else if (instr.op === '*' && instr.op1 === '1') { instr.op = ':='; instr.op1 = instr.op2; instr.op2 = ''; changed = true; }
        else if (instr.op === '*' && (instr.op1 === '0' || instr.op2 === '0')) { instr.op = ':='; instr.op1 = '0'; instr.op2 = ''; changed = true; }
        else if (instr.op === '-' && instr.op2 === '0') { instr.op = ':='; instr.op2 = ''; changed = true; }
        else if (instr.op === '/' && instr.op2 === '1') { instr.op = ':='; instr.op2 = ''; changed = true; }
    }
    
    // 3. Dead Code Elimination
    const used = new Set();
    for (let i = 0; i < optimized.length; i++) {
      if (optimized[i].op1) used.add(String(optimized[i].op1));
      if (optimized[i].op2) used.add(String(optimized[i].op2));
      if (optimized[i].op === 'if_false') used.add(String(optimized[i].result)); 
      if (optimized[i].op === 'goto') used.add(String(optimized[i].op1)); // label
      if (optimized[i].op === 'param') used.add(String(optimized[i].op1)); 
      if (optimized[i].op === 'return') used.add(String(optimized[i].op1)); 
    }
    const newOptimized = [];
    let dceChanged = false;
    for (let i = 0; i < optimized.length; i++) {
       let instr = optimized[i];
       if (instr.result && instr.result.startsWith('t') && !instr.result.endsWith(':') && !used.has(String(instr.result))) {
           dceChanged = true;
           continue;
       }
       newOptimized.push(instr);
    }
    if (dceChanged) {
        optimized = newOptimized;
        changed = true;
    }
  }
  return optimized;
}

function generateMachineCode(tac) {
  const code = [];
  let relCount = 0;
  tac.forEach(instr => {
    if (!instr.op && !instr.op1 && instr.result && instr.result.endsWith(':')) {
      code.push(instr.result);
      return;
    }
    if (instr.op === 'goto') { code.push(`JMP ${instr.op1}`); return; }
    if (instr.op === 'if_false') {
        code.push(`CMP ${instr.op1}, 0`);
        code.push(`JNZ 2`); 
        code.push(`JMP ${instr.op2}`);
        return;
    }
    if (instr.op === 'param') { code.push(`PUSH ${instr.op1}`); return; }
    if (instr.op === 'call') {
        code.push(`CALL ${instr.op1}`);
        if (instr.result) code.push(`MOV ${instr.result}, R0`);
        return;
    }
    if (instr.op === 'return') {
        if (instr.op1) code.push(`MOV R0, ${instr.op1}`);
        code.push(`RET`);
        return;
    }
    if (instr.op === ':=') {
        code.push(`MOV ${instr.result}, ${instr.op1}`);
        return;
    }
    const opMap = {'+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV'};
    if (opMap[instr.op]) {
        code.push(`MOV R1, ${instr.op1}`);
        code.push(`${opMap[instr.op]} R1, ${instr.op2}`);
        code.push(`MOV ${instr.result}, R1`);
        return;
    }
    const relMap = {'<': 'JL', '>': 'JG', '<=': 'JLE', '>=': 'JGE', '==': 'JE', '!=': 'JNE'};
    if (relMap[instr.op]) {
        code.push(`MOV R1, ${instr.op1}`);
        code.push(`CMP R1, ${instr.op2}`);
        code.push(`${relMap[instr.op]} TRUE_L${relCount}`);
        code.push(`MOV ${instr.result}, 0`);
        code.push(`JMP END_L${relCount}`);
        code.push(`TRUE_L${relCount}:`);
        code.push(`MOV ${instr.result}, 1`);
        code.push(`END_L${relCount}:`);
        relCount++;
        return;
    }
  });
  return code;
}

export { tokenizeC, parseC, generateICG, optimizeTAC, generateMachineCode };
