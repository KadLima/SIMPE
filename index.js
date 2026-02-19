require('dotenv').config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const ExcelJS = require('exceljs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fs = require('fs');
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const activeProcesses = new Map();
const multer = require('multer');
const upload = multer(); 
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const cron = require('node-cron');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

cron.schedule('* * * * *', () => {
  console.log('Executando verificação de expiração de recursos...');
  expirarRecursos();
});

// ROTA ESPECIAL PARA LOGIN APÓS PRIMEIRO ACESSO 
app.post('/api/login-pos-primeiro-acesso', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: email },
        });

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        if (user.primeiroAcesso) {
            return res.status(400).json({ error: 'Usuário ainda precisa completar o primeiro acesso.' });
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                userEmail: user.email, 
                role: user.role, 
                secretariaId: user.secretariaId,
                primeiroAcesso: false
            },
            process.env.JWT_SECRET || 'SEGREDO_SUPER_SECRETO',
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login bem-sucedido!',
            token: token,
            primeiroAcesso: false
        });

    } catch (error) {
        console.error("Erro na rota de login pós-primeiro acesso:", error);
        res.status(500).json({ error: 'Ocorreu um erro interno.' });
    }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 15, 
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 3, 
  message: {
    error: 'Muitas tentativas de recuperação de senha. Tente novamente em 15 minutos.'
  }
});

const captchaStore = new Map();

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) {
        return res.status(401).send('Acesso negado: Token não fornecido.');
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SEGREDO_SUPER_SECRETO', (err, user) => {
        if (err) {
            return res.status(403).send('Forbidden: Token inválido ou expirado.');
        }
        req.user = user; 
        next(); 
    });
}

function authenticateAdmin(req, res, next) {
    console.log("\n--- Verificando permissão de Admin ---");
    console.log("Conteúdo do crachá (req.user):", req.user); 

    if (req.user && req.user.role === 'ADMIN') {
        console.log("Resultado: Permissão CONCEDIDA.");
        next(); 
    } else {
        console.log("Resultado: Permissão NEGADA.");
        return res.status(403).send('Forbidden: Requer privilégios de administrador.');
    }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static('public/assets'));

function generateCaptcha() {
  const text = crypto.randomBytes(3).toString('hex').toUpperCase();
  const id = crypto.randomBytes(8).toString('hex');
  captchaStore.set(id, text);
  setTimeout(() => captchaStore.delete(id), 10 * 60 * 1000);
  return { id, text };
}

function validateCaptcha(id, answer) {
  const stored = captchaStore.get(id);
  if (!stored) return false;
  captchaStore.delete(id); 
  return stored === answer.toUpperCase();
}

// Validação de força da senha
function isPasswordStrong(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  return {
    isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
    requirements: {
      minLength: password.length >= minLength,
      hasUpperCase,
      hasLowerCase,
      hasNumbers,
      hasSpecialChar
    }
  };
}

// Geração de senha forte sugerida
function generateStrongPassword() {
  const length = 12;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  
  password += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[crypto.randomInt(26)];
  password += "abcdefghijklmnopqrstuvwxyz"[crypto.randomInt(26)];
  password += "0123456789"[crypto.randomInt(10)];
  password += "!@#$%^&*"[crypto.randomInt(8)];
  
  for (let i = password.length; i < length; i++) {
    password += charset[crypto.randomInt(charset.length)];
  }
  
  return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// ROTA PARA GERAR CAPTCHA
app.get('/api/captcha', (req, res) => {
  const captcha = generateCaptcha();
  res.json({ 
    id: captcha.id, 
    text: captcha.text 
  });
});

// ROTA PARA VERIFICAR FORÇA DA SENHA
app.post('/api/check-password-strength', (req, res) => {
  const { password } = req.body;
  const strength = isPasswordStrong(password);
  res.json(strength);
});

// ROTA PARA GERAR SENHA SUGERIDA
app.get('/api/suggest-password', (req, res) => {
  const suggestedPassword = generateStrongPassword();
  res.json({ password: suggestedPassword });
});

// --- ROTAS DE PÁGINAS ---
app.get("/", (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get("/scanner", (req, res) => { res.sendFile(path.join(__dirname, 'scanner.html')); });
app.get("/formulario", (req, res) => { res.sendFile(path.join(__dirname, 'formulario.html')); });
app.get("/admin", (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get("/nota-final/:id", (req, res) => { res.sendFile(path.join(__dirname, 'nota-final.html')); });
app.get('/avaliacao/:id', (req, res) => { res.sendFile(path.join(__dirname, 'avaliacao.html')); });
app.get("/login", (req, res) => {res.sendFile(path.join(__dirname, 'login.html')); });
app.get("/dashboard", (req, res) => { res.sendFile(path.join(__dirname, 'dashboard.html')); });
app.get("/avaliacao-usuario/:id", (req, res) => { res.sendFile(path.join(__dirname, 'avaliacao-usuario.html')); });
app.get("/analise-final/:id", (req, res) => { res.sendFile(path.join(__dirname, 'analise-final.html')); });

app.post('/login', loginLimiter, async (req, res) => {
  const { email, password, captchaId, captchaAnswer } = req.body;

  if (!email || !password || !captchaId || !captchaAnswer) {
    return res.status(400).json({ error: 'E-mail, senha e CAPTCHA são obrigatórios.' });
  }

  if (!validateCaptcha(captchaId, captchaAnswer)) {
    return res.status(400).json({ error: 'CAPTCHA inválido.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.primeiroAcesso) {
      return res.status(403).json({ 
        error: 'Primeiro acesso requerido. Complete seu cadastro.',
        primeiroAcesso: true,
        email: user.email
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        userEmail: user.email, 
        role: user.role, 
        secretariaId: user.secretariaId,
        primeiroAcesso: false
      },
      process.env.JWT_SECRET || 'SEGREDO_SUPER_SECRETO',
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login bem-sucedido!',
      token: token,
      primeiroAcesso: false,
      user: { 
        id: user.id,
        email: user.email,
        role: user.role,
        secretariaId: user.secretariaId
      }
    });

  } catch (error) {
    console.error("Erro na rota de login:", error);
    res.status(500).json({ error: 'Ocorreu um erro interno.' });
  }
});

app.post('/api/recuperar-senha', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const usuario = await prisma.user.findUnique({
      where: { email },
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Email não encontrado no sistema' });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expiraEm = new Date(Date.now() + 30 * 60 * 1000); 

    await prisma.codigoVerificacao.create({
      data: {
        email,
        codigo,
        tipo: 'recuperacao',
        expiraEm,
      },
    });

    try {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Recuperação de Senha - Sistema de Monitoramento da Transparência',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
              <meta charset="utf-8">
              <style>
                  body { 
                      font-family: Arial, sans-serif; 
                      line-height: 1.6; 
                      color: #333; 
                      max-width: 600px; 
                      margin: 0 auto;
                      background: #f5f5f5;
                  }
                  .email-container {
                      background: white;
                      border-radius: 8px;
                      overflow: hidden;
                      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                  }
                  .header-img {
                      width: 100%;
                      max-width: 600px;
                      height: auto;
                      display: block;
                      object-fit: contain;
                  }
                  .content { 
                      padding: 30px; 
                  }
                  .footer { 
                      background: #e9ecef; 
                      padding: 20px; 
                      text-align: center; 
                      font-size: 12px; 
                      color: #666;
                  }
                  .codigo-verificacao {
                      background: #f8f9fa; 
                      padding: 25px; 
                      text-align: center; 
                      font-size: 32px; 
                      font-weight: bold; 
                      letter-spacing: 8px; 
                      margin: 25px 0; 
                      border: 2px dashed #dee2e6;
                      border-radius: 8px;
                      font-family: 'Courier New', monospace;
                  }
                  .alerta {
                      background: #fff3cd;
                      border: 1px solid #ffeaa7;
                      border-radius: 6px;
                      padding: 15px;
                      margin: 15px 0;
                      color: #856404;
                  }
                  .footer-images {
                      display: flex;
                      justify-content: center;
                      gap: 20px;
                      margin: 15px 0;
                      align-items: center;
                  }
                  .footer-img {
                      max-width: 150px;
                      height: 60px;
                      object-fit: contain;
                  }
                  .footer-img[alt="SIMPE"] {
                      max-width: 200px;
                      height: 80px;
                  }
                  h3 { color: #002776; margin-top: 0; }
              </style>
          </head>
          <body>
              <div class="email-container">
                  <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                       alt="Controladoria Geral do Estado" 
                       class="header-img">
                  
                  <div class="content">
                      <h3>Recuperação de Senha</h3>
                      
                      <p>Olá,</p>
                      <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>Sistema de Monitoramento da Transparência</strong>.</p>
                      
                      <p>Seu código de verificação é:</p>
                      
                      <div class="codigo-verificacao">
                          ${codigo}
                      </div>
                      
                      <div class="alerta">
                          <p><strong>⚠️ Este código expira em 30 minutos.</strong></p>
                          <p>Não compartilhe este código com ninguém.</p>
                      </div>
                      
                      <p>Se você não solicitou a recuperação de senha, por favor ignore este email.</p>
                      
                      <p style="margin-top: 25px;">
                          Atenciosamente,<br>
                          <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                      </p>
                  </div>
                  
                  <div class="footer">
                      <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                      <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                      R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                      
                      <div class="footer-images">
                          <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                               alt="SIMPE" 
                               class="footer-img">
                          <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                               alt="Governo de Pernambuco" 
                               class="footer-img">
                      </div>
                  </div>
              </div>
          </body>
          </html>
        `,
      });
    } catch (emailError) {
      console.error('Erro ao enviar email:', emailError);
      return res.status(500).json({ error: 'Erro ao enviar código por email' });
    }

    res.json({ success: true, message: 'Código de verificação enviado para seu email' });

  } catch (error) {
    console.error('Erro na recuperação de senha:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/api/verificar-codigo', async (req, res) => {
  try {
    const { email, codigo, tipo } = req.body;

    if (!email || !codigo || !tipo) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    const codigoVerificacao = await prisma.codigoVerificacao.findFirst({
      where: {
        email,
        codigo,
        tipo,
        usado: false,
        expiraEm: { gt: new Date() },
      },
    });

    if (!codigoVerificacao) {
      return res.status(400).json({ error: 'Código inválido ou expirado' });
    }

    await prisma.codigoVerificacao.update({
      where: { id: codigoVerificacao.id },
      data: { usado: true },
    });

    res.json({ success: true, message: 'Código verificado com sucesso' });

  } catch (error) {
    console.error('Erro na verificação do código:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// 3. Redefinir senha
app.post('/api/redefinir-senha', passwordRecoveryLimiter, async (req, res) => {
  try {
    const { email, novaSenha } = req.body;

    if (!email || !novaSenha) {
      return res.status(400).json({ error: 'Email e nova senha são obrigatórios' });
    }

    const passwordCheck = isPasswordStrong(novaSenha);
    if (!passwordCheck.isValid) {
      return res.status(400).json({ 
        error: 'A senha não atende aos critérios de segurança.',
        requirements: passwordCheck.requirements
      });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, 12);

    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    res.json({ success: true, message: 'Senha redefinida com sucesso' });

  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).json({ error: 'Erro interno ao redefinir senha' });
  }
});

app.post('/api/primeiro-acesso', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const usuario = await prisma.user.findUnique({
      where: { email },
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Email não encontrado no sistema' });
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expiraEm = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.codigoVerificacao.create({
      data: {
        email,
        codigo,
        tipo: 'primeiro_acesso',
        expiraEm,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: 'Primeiro Acesso - Sistema de Monitoramento da Transparência',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    line-height: 1.6; 
                    color: #333; 
                    max-width: 600px; 
                    margin: 0 auto;
                    background: #f5f5f5;
                }
                .email-container {
                    background: white;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .header-img {
                    width: 100%;
                    max-width: 600px;
                    height: auto;
                    display: block;
                    object-fit: contain;
                }
                .content { 
                    padding: 30px; 
                }
                .footer { 
                    background: #e9ecef; 
                    padding: 20px; 
                    text-align: center; 
                    font-size: 12px; 
                    color: #666;
                }
                .codigo-verificacao {
                    background: #f8f9fa; 
                    padding: 25px; 
                    text-align: center; 
                    font-size: 32px; 
                    font-weight: bold; 
                    letter-spacing: 8px; 
                    margin: 25px 0; 
                    border: 2px dashed #dee2e6;
                    border-radius: 8px;
                    font-family: 'Courier New', monospace;
                }
                .alerta {
                    background: #e8f5e8;
                    border: 1px solid #c3e6cb;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 15px 0;
                    color: #155724;
                }
                .footer-images {
                    display: flex;
                    justify-content: center;
                    gap: 20px;
                    margin: 15px 0;
                    align-items: center;
                }
                .footer-img {
                    max-width: 150px;
                    height: 60px;
                    object-fit: contain;
                }
                .footer-img[alt="SIMPE"] {
                    max-width: 200px;
                    height: 80px;
                }
                h3 { color: #002776; margin-top: 0; }
                .destaque {
                    background: #e8f4fd;
                    border: 1px solid #b3d9ff;
                    border-radius: 6px;
                    padding: 15px;
                    margin: 15px 0;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                     alt="Controladoria Geral do Estado" 
                     class="header-img">
                
                <div class="content">
                    <h3>Primeiro Acesso ao Sistema</h3>
                    
                    <div class="destaque">
                        <p><strong>Bem-vindo(a) ao Sistema de Monitoramento da Transparência!</strong></p>
                    </div>
                    
                    <p>Olá,</p>
                    <p>Você foi cadastrado(a) como responsável pela avaliação de transparência do seu órgão/entidade.</p>
                    <p>Para criar sua senha e acessar o sistema pela primeira vez, utilize o código de verificação abaixo:</p>
                    
                    <div class="codigo-verificacao">
                        ${codigo}
                    </div>
                    
                    <div class="alerta">
                        <p><strong>✅ Este código expira em 30 minutos.</strong></p>
                        <p>Após a criação da senha, você poderá acessar o sistema normalmente.</p>
                    </div>
                    
                    <p><strong>Próximos passos:</strong></p>
                    <ul>
                        <li>Insira este código na tela de primeiro acesso</li>
                        <li>Crie uma senha segura para sua conta</li>
                        <li>Faça login no sistema com seu email e a nova senha</li>
                    </ul>
                    
                    <p style="margin-top: 25px;">
                        Atenciosamente,<br>
                        <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                    </p>
                </div>
                
                <div class="footer">
                    <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                    <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                    R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                    
                    <div class="footer-images">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                             alt="SIMPE" 
                             class="footer-img">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                             alt="Governo de Pernambuco" 
                             class="footer-img">
                    </div>
                </div>
            </div>
        </body>
        </html>
      `,
    });

    res.json({ success: true, message: 'Código de verificação enviado' });

  } catch (error) {
    console.error('Erro no primeiro acesso:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/api/criar-senha', passwordRecoveryLimiter, async (req, res) => {
  try {
    const { email, novaSenha } = req.body;

    if (!email || !novaSenha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const passwordCheck = isPasswordStrong(novaSenha);
    if (!passwordCheck.isValid) {
      return res.status(400).json({ 
        error: 'A senha não atende aos critérios de segurança.',
        requirements: passwordCheck.requirements
      });
    }

    const hashedPassword = await bcrypt.hash(novaSenha, 12);

    const usuarioAtualizado = await prisma.user.update({
      where: { email },
      data: { 
        password: hashedPassword,
        primeiroAcesso: false 
      },
    });

    const token = jwt.sign(
      { 
        userId: usuarioAtualizado.id, 
        userEmail: usuarioAtualizado.email, 
        role: usuarioAtualizado.role, 
        secretariaId: usuarioAtualizado.secretariaId,
        primeiroAcesso: false
      },
      process.env.JWT_SECRET || 'SEGREDO_SUPER_SECRETO',
      { expiresIn: '8h' }
    );

    res.json({ 
      success: true, 
      message: 'Senha criada com sucesso',
      token: token,
      user: {
        id: usuarioAtualizado.id,
        email: usuarioAtualizado.email,
        role: usuarioAtualizado.role,
        secretariaId: usuarioAtualizado.secretariaId
      }
    });

  } catch (error) {
    console.error('Erro ao criar senha:', error);
    res.status(500).json({ error: 'Erro interno ao criar senha' });
  }
});

// ROTA PARA ADMIN CRIAR NOVOS USUÁRIOS
app.post('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
  const { email, password, role, secretariaId } = req.body;

  console.log(`[ADMIN] Recebida solicitação para criar usuário: ${email}, Role: ${role}, SecID: ${secretariaId}`);

  if (!email || !password || !role || !secretariaId) {
    return res.status(400).json({ error: 'Todos os campos (email, senha, papel, secretaria) são obrigatórios.' });
  }
  
  if (role !== 'ADMIN' && role !== 'USER') {
      return res.status(400).json({ error: 'Papel (role) inválido. Deve ser ADMIN ou USER.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      console.warn(`[ADMIN] Falha: Email ${email} já existe.`);
      return res.status(409).json({ error: 'Este endereço de e-mail já está em uso.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10); 

    const newUser = await prisma.user.create({
      data: {
        nome: 'Usuário', 
        email: email.toLowerCase(),
        password: hashedPassword,
        role: role, 
        secretariaId: parseInt(secretariaId),
      },
    });

    console.log(`[ADMIN] ✅ Usuário ${newUser.email} criado com sucesso.`);
    
    const { password: _, ...userSemSenha } = newUser;
    res.status(201).json(userSemSenha);

  } catch (error) {
    console.error('[ADMIN] Erro ao criar usuário:', error);
    if (error.code === 'P2003' || error.message.includes('Foreign key constraint failed')) {
         return res.status(400).json({ error: 'ID da Secretaria não encontrado. Verifique se a secretaria selecionada é válida.' });
    }
    res.status(500).json({ error: 'Erro interno ao criar usuário.', details: error.message });
  }
});

// ROTA PARA LISTAR TODOS OS USUÁRIOS (APENAS ADMIN)
app.get('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                nome: true,
                role: true,
                secretariaId: true,
                primeiroAcesso: true,
                createdAt: true,
                secretaria: {
                    select: {
                        id: true,
                        nome: true,
                        sigla: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json(users);
    } catch (error) {
        console.error('[ADMIN] Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro interno ao buscar usuários.' });
    }
});

// ROTA PARA EXCLUIR USUÁRIO 
app.delete('/api/users/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const user = await prisma.user.findUnique({
            where: { id: parseInt(id) }
        });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        if (parseInt(id) === req.user.userId) {
            return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
        }

        // Impedir exclusão de outros administradores (opcional - descomente se quiser)
        // if (user.role === 'ADMIN') {
        //     return res.status(400).json({ error: 'Não é permitido excluir outros administradores.' });
        // }

        // Excluir o usuário
        await prisma.user.delete({
            where: { id: parseInt(id) }
        });

        console.log(`[ADMIN] Usuário ${user.email} excluído por ${req.user.userEmail}`);
        res.json({ success: true, message: 'Usuário excluído com sucesso.' });

    } catch (error) {
        console.error('[ADMIN] Erro ao excluir usuário:', error);
        
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        
        res.status(500).json({ error: 'Erro interno ao excluir usuário.' });
    }
});

// ROTA PARA ADMIN CRIAR NOVAS SECRETARIAS
app.post('/api/secretarias', authenticateToken, authenticateAdmin, async (req, res) => {
  const { nome, sigla, url } = req.body;

  console.log(`[ADMIN] Recebida solicitação para criar secretaria: ${sigla} - ${nome}`);

  if (!nome || !sigla || !url) {
    return res.status(400).json({ error: 'Todos os campos (nome, sigla, URL) são obrigatórios.' });
  }

  const siglaRegex = /^[A-Z]{2,10}$/;
  if (!siglaRegex.test(sigla)) {
    return res.status(400).json({ error: 'A sigla deve conter apenas letras maiúsculas e ter entre 2 e 10 caracteres.' });
  }

  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'URL inválida. Certifique-se de incluir http:// ou https://.' });
  }

  try {
    const existingSigla = await prisma.secretaria.findUnique({
      where: { sigla: sigla.toUpperCase() },
    });

    if (existingSigla) {
      console.warn(`[ADMIN] Falha: Sigla ${sigla} já existe.`);
      return res.status(409).json({ error: 'Esta sigla já está em uso.' });
    }

    const existingNome = await prisma.secretaria.findUnique({
      where: { nome: nome },
    });

    if (existingNome) {
      console.warn(`[ADMIN] Falha: Nome ${nome} já existe.`);
      return res.status(409).json({ error: 'Este nome já está em uso.' });
    }

    const novaSecretaria = await prisma.secretaria.create({
      data: {
        nome: nome.trim(),
        sigla: sigla.toUpperCase().trim(),
        url: url.trim(),
      },
    });

    console.log(`[ADMIN] ✅ Secretaria ${novaSecretaria.sigla} criada com sucesso.`);
    
    res.status(201).json(novaSecretaria);

  } catch (error) {
    console.error('[ADMIN] Erro ao criar secretaria:', error);
    res.status(500).json({ error: 'Erro interno ao criar secretaria.', details: error.message });
  }
});

// ROTA PARA O USUÁRIO LOGADO BUSCAR SUAS PRÓPRIAS AVALIAÇÕES (VERSÃO DE DIAGNÓSTICO)
app.get('/api/my-avaliacoes', authenticateToken, async (req, res) => {
    console.log("\n--- [DASHBOARD] Rota /api/my-avaliacoes foi chamada ---");
    try {
        const userId = req.user.userId;
        console.log(`[DASHBOARD] Buscando dados para o usuário com ID: ${userId}`);
        
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { secretariaId: true }
        });

        if (!user) {
            console.log(`[DASHBOARD] ERRO: Usuário com ID ${userId} não encontrado no banco.`);
            return res.status(404).json({ error: "Usuário não encontrado." });
        }
        console.log(`[DASHBOARD] Secretaria do usuário encontrada. ID da Secretaria: ${user.secretariaId}`);

        const avaliacoes = await prisma.avaliacao.findMany({
            where: { secretariaId: user.secretariaId },
            orderBy: { createdAt: 'desc' },
            include: {
                secretaria: {
                    select: { sigla: true }
                }
            }
        });
        console.log(`[DASHBOARD] Prisma encontrou ${avaliacoes.length} avaliações para esta secretaria.`);
        
        res.json(avaliacoes);

    } catch (error) {
        console.error("[DASHBOARD] ERRO CRÍTICO na rota:", error); 
        res.status(500).json({ error: 'Ocorreu um erro ao buscar suas avaliações.' });
    }
});

// ROTA 2: Busca a avaliação finalizada para exibição na página de Nota Final
app.get('/api/my-nota-final/:id', authenticateToken, async (req, res) => {
    try {
        const { id: avaliacaoId } = req.params;
        const { user } = req; 

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(avaliacaoId) },
            include: {
                secretaria: true,
                respostas: {
                    include: {
                        requisito: true,
                        evidencias: true,
                        linksAnalista: true,
                        linksAnaliseFinal: true
                    }
                }
            }
        });

        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada.' });
        }

        if (avaliacao.secretariaId !== user.secretariaId || avaliacao.status !== 'FINALIZADA') {
            return res.status(403).json({ error: 'Acesso negado ou avaliação ainda não finalizada pela SCGE.' });
        }

        res.json(avaliacao);

    } catch (error) {
        console.error("Erro ao buscar nota final:", error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao carregar a nota final.' });
    }
});

// ROTA PARA ADMIN VISUALIZAR NOTA FINAL DE QUALQUER SECRETARIA
app.get('/api/admin/nota-final/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id: avaliacaoId } = req.params;

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(avaliacaoId) },
            include: {
                secretaria: true,
                respostas: {
                    include: {
                        requisito: true,
                        evidencias: true,
                        linksAnalista: true,
                        linksAnaliseFinal: true
                    }
                }
            }
        });

        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada.' });
        }

        res.json(avaliacao);

    } catch (error) {
        console.error("Erro ao buscar nota final para admin:", error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao carregar a nota final.' });
    }
});

// ROTA SEGURA PARA UM USUÁRIO VER OS DETALHES DE UMA DE SUAS AVALIAÇÕES (MODIFICADA)
app.get('/api/my-avaliacoes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { secretariaId: true }
        });
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(id) },
            include: { 
                secretaria: true, 
                respostas: {
                    include: {
                        requisito: true,
                        evidencias: true,
                        linksAnalista: true,
                        linksAnaliseFinal: true,
                        subRespostas: {
                            include: {
                                subRequisito: true,
                                evidencias: true
                            },
                            orderBy: {
                                subRequisito: {
                                    ordem: 'asc'
                                }
                            }
                        }
                    },
                    orderBy: {
                        requisitoId: 'asc'
                    }
                } 
            }
        });

        if (!avaliacao || avaliacao.secretariaId !== user.secretariaId) {
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para ver esta avaliação." });
        }

        res.json(avaliacao);
    } catch (error) {
        console.error("Erro ao buscar detalhes da avaliação do usuário:", error);
        res.status(500).json({ error: 'Ocorreu um erro ao buscar os detalhes da avaliação.' });
    }
});

app.get('/secretarias/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const secretaria = await prisma.secretaria.findUnique({ where: { id: parseInt(id) } });
        if (!secretaria) return res.status(404).json({ error: 'Secretaria não encontrada.' });
        res.json(secretaria);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar secretaria.' });
    }
});

// ROTA PARA O PRÉ-VALIDADOR
app.post('/pre-validate', async (req, res) => {
  const { urlSecretaria } = req.body;
  if (!urlSecretaria) {
    return res.status(400).json({ error: 'urlSecretaria é obrigatória' });
  }

  try {
    const linksPrincipais = await prisma.requisito.findMany({
      where: { 
        linkFixo: { not: null },
        NOT: { linkFixo: { contains: 'KEYWORD:' } }
      }
    });
    
    const subRequisitos = await prisma.subRequisito.findMany({
      where: { linkFixo: { not: null } }
    });
    
    const todosLinks = [
      ...linksPrincipais.map(r => r.linkFixo),
      ...subRequisitos.map(s => s.linkFixo)
    ].filter(link => link && !link.startsWith('KEYWORD:'));
    
    console.log(`🔍 Pré-validador procurando ${todosLinks.length} links (${linksPrincipais.length} principais + ${subRequisitos.length} subitens)`);
    
    if (todosLinks.length === 0) {
      return res.json([]);
    }

    const scriptPath = path.join(__dirname, 'pre_validador.py');
    const scriptArgs = [
      scriptPath,
      urlSecretaria,
      '--find-links', 
      todosLinks.join(',')
    ];

    const pythonProcess = spawn('python', scriptArgs, { cwd: __dirname });

    let resultadoJson = '';
    let erroOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      resultadoJson += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      erroOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Erro no script pre_validador.py: ${erroOutput}`);
        return res.status(500).json({ error: 'Falha na verificação automática.', details: erroOutput });
      }
      try {
        const linksEncontrados = JSON.parse(resultadoJson || '[]');
        console.log(`✅ Pré-validador encontrou ${linksEncontrados.length} links`);
        res.json(linksEncontrados);
      } catch (parseError) {
        console.error('Erro ao parsear resultado:', parseError);
        res.status(500).json({ error: 'Falha ao interpretar resultado da verificação.', details: resultadoJson });
      }
    });

  } catch (error) {
    console.error('Erro na pré-validação:', error);
    res.status(500).json({ error: 'Erro interno no servidor ao tentar pré-validar.' });
  }
});

// ROTA PARA A VARREDURA COMPLETA
app.post('/start-crawl', authenticateToken, async (req, res) => {
  const { url, depth } = req.body;
  if (!url) { return res.status(400).json({ error: 'URL é obrigatória' }); }
  try {
    const sessionId = `session_${Date.now()}`;
    await prisma.scanSession.create({ data: { id: sessionId, url_base: url, status: 'iniciado' } });
    
    const scriptPath = path.join(__dirname, 'ScannerUnificado.py');
    const scriptArgs = [scriptPath, url, '--session-id', sessionId, '--depth', String(depth || 5)];
    const pythonProcess = spawn('python', scriptArgs, { cwd: __dirname });

    activeProcesses.set(sessionId, { process: pythonProcess, url: url, startTime: new Date() });
    pythonProcess.stdout.on('data', (data) => { console.log(`[${sessionId}]:`, data.toString().trim()); });
    pythonProcess.stderr.on('data', (data) => { console.error(`[${sessionId} Error]:`, data.toString().trim()); });
    pythonProcess.on('close', (code) => {
      console.log(`[${sessionId}] Processo finalizado com código: ${code}`);
      activeProcesses.delete(sessionId);
    });
    res.json({ success: true, message: 'Varredura iniciada!', sessionId: sessionId });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao iniciar varredura: ' + error.message });
  }
});

// ROTA PARA CRIAR LINKS (usada pelo scanner_completo.py)
app.post("/links", async (req, res) => {
  try {
    const { url, tipo, origem, status, httpCode, finalUrl, profundidade, session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ error: 'session_id é obrigatório.' });
    }
    const newLink = await prisma.link.create({
      data: {
        url, tipo, origem, status: status || "Não verificado", httpCode, finalUrl, profundidade,
        session: { connect: { id: session_id } },
      },
    });
    res.status(201).json(newLink);
  } catch (error) {
    console.error("[ERRO CRÍTICO] Falha ao criar link:", error);
    if (error.code === 'P2025') {
       return res.status(400).json({ error: `Falha: ScanSession com id '${req.body.session_id}' não existe.` });
    }
    res.status(500).json({ error: "Erro ao criar link" });
  }
});

// ROTA PARA O ADMIN VALIDAR UMA RESPOSTA ESPECÍFICA
app.patch('/api/respostas/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { 
      statusValidacao, comentarioAdmin,
      linksAnalista, recursoAtende
    } = req.body;

    console.log(`=== ATUALIZANDO RESPOSTA ${id} ===`);
    console.log('Links recebidos:', linksAnalista);

    try {
      const resultado = await prisma.$transaction(async (prisma) => {
          const dataToUpdate = {};
          if (statusValidacao) dataToUpdate.statusValidacao = statusValidacao;
          if (comentarioAdmin !== undefined) dataToUpdate.comentarioAdmin = comentarioAdmin;
          if (recursoAtende !== undefined) dataToUpdate.recursoAtende = recursoAtende;

          const respostaAtualizada = await prisma.resposta.update({
              where: { id: parseInt(id) },
              data: dataToUpdate
          });

          if (linksAnalista !== undefined) {
              console.log('Processando linksAnalista:', linksAnalista);
              
              await prisma.linkAnalista.deleteMany({
                  where: { respostaId: parseInt(id) }
              });

              if (Array.isArray(linksAnalista) && linksAnalista.length > 0) {
                const linksValidos = linksAnalista.filter(link => 
                    link && typeof link === 'string' && link.trim() !== ''
                );

                if (linksValidos.length > 0) {
                    await prisma.linkAnalista.createMany({
                        data: linksValidos.map(link => ({
                            url: link.trim(),
                            respostaId: parseInt(id)
                        }))
                    });
                }
              }
          }

          return await prisma.resposta.findUnique({
              where: { id: parseInt(id) },
              include: {
                requisito: true,
                evidencias: true,
                linksAnalista: true,
                linksAnaliseFinal: true
              }
          });
      });

      console.log('✅ Resposta atualizada com sucesso:', {
          id: resultado.id,
          totalLinks: resultado.linksAnalista.length
      });

      res.json(resultado);

    }catch (error) {
      console.error(`❌ Erro ao atualizar resposta ${id}:`, error);
      res.status(500).json({ error: "Erro ao salvar a validação." });
    }
});

app.patch('/api/respostas/:id/analise-final', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { analiseFinal, atende, comentarioAnaliseFinal, linksAnaliseFinal } = req.body;

        console.log('Recebendo análise final com nova estrutura:', { 
            analiseFinal, 
            atende, 
            comentarioAnaliseFinal,
            linksAnaliseFinal 
        });

        const respostaAtual = await prisma.resposta.findUnique({
            where: { id: parseInt(id) },
            include: { 
                requisito: true,
                linksAnaliseFinal: true
            }
        });

        if (!respostaAtual) {
            return res.status(404).json({ error: 'Resposta não encontrada' });
        }

        const resultado = await prisma.$transaction(async (prisma) => {
            const dataToUpdate = {
                analiseFinal: analiseFinal,
                statusRecurso: 'analisado'
            };

            if (comentarioAnaliseFinal !== undefined) {
                dataToUpdate.comentarioAnaliseFinal = comentarioAnaliseFinal;
            }

            if (atende !== undefined) {
                dataToUpdate.atende = atende;
            }

            console.log('Atualizando dados básicos:', dataToUpdate);

            const respostaAtualizada = await prisma.resposta.update({
                where: { id: parseInt(id) },
                data: dataToUpdate
            });

            console.log('Processando linksAnaliseFinal:', linksAnaliseFinal);
            
            await prisma.linkAnaliseFinal.deleteMany({
                where: { respostaId: parseInt(id) }
            });

            if (linksAnaliseFinal && Array.isArray(linksAnaliseFinal) && linksAnaliseFinal.length > 0) {
                const linksValidos = linksAnaliseFinal.filter(link => 
                    link && typeof link === 'string' && link.trim() !== ''
                );

                console.log('Links válidos encontrados:', linksValidos);

                if (linksValidos.length > 0) {
                    await prisma.linkAnaliseFinal.createMany({
                        data: linksValidos.map(link => ({
                            url: link.trim(),
                            respostaId: parseInt(id)
                        }))
                    });
                    console.log(`✅ ${linksValidos.length} links de análise final criados`);
                }
            } else {
                console.log('⚠️ Nenhum link válido para salvar ou linksAnaliseFinal é undefined');
            }

            return await prisma.resposta.findUnique({
                where: { id: parseInt(id) },
                include: {
                    requisito: true,
                    evidencias: true,
                    linksAnaliseFinal: true
                }
            });
        });

        console.log('✅ Análise final salva com sucesso - Nova estrutura');

        const respostaFormatada = {
            ...resultado,
            atende: resultado.atende,
            comentarioAnaliseFinal: resultado.comentarioAnaliseFinal,
            linksAnaliseFinal: resultado.linksAnaliseFinal ? resultado.linksAnaliseFinal.map(link => link.url) : []
        };

        res.json(respostaFormatada);

    } catch (error) {
        console.error('❌ Erro ao salvar análise final:', error);
        res.status(500).json({ error: 'Erro interno ao salvar análise final' });
    }
});

app.patch('/api/requisitos/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { texto, pontuacao, textoAjuda } = req.body;
    try {
        const atualizado = await prisma.requisito.update({
            where: { id: parseInt(id) },
            data: { 
                texto, 
                pontuacao: parseInt(pontuacao), 
                textoAjuda 
            }
        });
        res.json(atualizado);
    } catch (error) {
        res.status(500).json({ error: "Erro ao atualizar requisito." });
    }
});

app.post('/api/respostas/:id/subitens', authenticateToken, async (req, res) => {
  try {
    const { id: respostaId } = req.params;
    const { subitens } = req.body;
    
    console.log(`📝 Salvando ${subitens.length} subitens para resposta ${respostaId}`);
    
    const resultado = await prisma.$transaction(async (prisma) => {
      const subRespostas = [];
      
      for (const sub of subitens) {
        // Verificar se já existe
        const existente = await prisma.subResposta.findFirst({
          where: {
            respostaId: parseInt(respostaId),
            subRequisitoId: sub.subRequisitoId
          }
        });
        
        if (existente) {
          // Atualizar existente
          const atualizada = await prisma.subResposta.update({
            where: { id: existente.id },
            data: {
              atende: sub.atende,
              linkComprovante: sub.linkComprovante,
              comentarioSecretaria: sub.comentario,
              statusValidacao: 'pendente' 
            }
          });
          subRespostas.push(atualizada);
        } else {
          const nova = await prisma.subResposta.create({
            data: {
              respostaId: parseInt(respostaId),
              subRequisitoId: sub.subRequisitoId,
              atende: sub.atende,
              linkComprovante: sub.linkComprovante,
              comentarioSecretaria: sub.comentario,
              statusValidacao: 'pendente'
            }
          });
          subRespostas.push(nova);
        }
      }
      
      return subRespostas;
    });
    
    res.json({ success: true, subRespostas: resultado });
    
  } catch (error) {
    console.error('❌ Erro ao salvar subitens:', error);
    res.status(500).json({ error: 'Erro ao salvar subitens' });
  }
});

// ROTA PARA VALIDAR SUBITENS (ANALISTA)
app.patch('/api/subrespostas/:id/validar', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { statusValidacao, comentario } = req.body;
    
    const subResposta = await prisma.subResposta.update({
      where: { id: parseInt(id) },
      data: {
        statusValidacao,
        comentarioAdmin: comentario
      }
    });
    
    await recalcularStatusRespostaPai(subResposta.respostaId);
    
    res.json(subResposta);
    
  } catch (error) {
    console.error('❌ Erro ao validar subitem:', error);
    res.status(500).json({ error: 'Erro ao validar subitem' });
  }
});

// ROTA PARA VALIDAR SUBITENS NO RECURSO (ANÁLISE FINAL)
app.patch('/api/subrespostas/:id/validar-recurso', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { statusValidacaoPosRecurso, comentario } = req.body;
    
    const subResposta = await prisma.subResposta.update({
      where: { id: parseInt(id) },
      data: {
        statusValidacaoPosRecurso,
        comentarioAnaliseFinal: comentario
      }
    });
    
    await recalcularStatusRespostaPai(subResposta.respostaId, true);
    
    res.json(subResposta);
    
  } catch (error) {
    console.error('❌ Erro ao validar subitem no recurso:', error);
    res.status(500).json({ error: 'Erro ao validar subitem no recurso' });
  }
});

// ROTA PARA SALVAR RECURSO DE SUBITENS (SECRETARIA)
app.post('/api/subrespostas/recurso', authenticateToken, async (req, res) => {
  try {
    const { subRespostas } = req.body;
    
    const resultado = await prisma.$transaction(async (prisma) => {
      const atualizadas = [];
      
      for (const sub of subRespostas) {
        const atualizada = await prisma.subResposta.update({
          where: { id: sub.id },
          data: {
            atende: sub.atende,
            linkComprovante: sub.linkComprovante,
            comentarioRecurso: sub.comentario,
            statusValidacaoPosRecurso: 'pendente' 
          }
        });
        atualizadas.push(atualizada);
      }
      
      return atualizadas;
    });
    
    res.json({ success: true, subRespostas: resultado });
    
  } catch (error) {
    console.error('❌ Erro ao salvar recurso de subitens:', error);
    res.status(500).json({ error: 'Erro ao salvar recurso de subitens' });
  }
});

// ROTA PARA BUSCAR SUBITENS DE UMA RESPOSTA
app.get('/api/respostas/:id/subitens', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const subRespostas = await prisma.subResposta.findMany({
      where: { respostaId: parseInt(id) },
      include: {
        subRequisito: true,
        evidencias: true
      },
      orderBy: {
        subRequisito: {
          ordem: 'asc'
        }
      }
    });
    
    res.json(subRespostas);
    
  } catch (error) {
    console.error('❌ Erro ao buscar subitens:', error);
    res.status(500).json({ error: 'Erro ao buscar subitens' });
  }
});

app.post('/api/avaliacoes/:id/devolver', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    function calcularPrazoRecurso(dataInicio) {
      let data = new Date(dataInicio);
      let diasUteis = 0;
      const diasNecessarios = 5;
      
      data.setDate(data.getDate() + 1);
      data.setHours(0, 0, 1, 0);
      
      let diaSemana = data.getDay();
      if (diaSemana === 0) {
        data.setDate(data.getDate() + 1); 
      } else if (diaSemana === 6) { 
        data.setDate(data.getDate() + 2); 
      }
      
      while (diasUteis < diasNecessarios) {
        data.setDate(data.getDate() + 1);
        diaSemana = data.getDay();
        if (diaSemana !== 0 && diaSemana !== 6) {
          diasUteis++;
        }
      }
      
      data.setHours(23, 59, 59, 0);
      
      return data;
    }

    const dataRecebimento = new Date(); 
    const prazoRecurso = calcularPrazoRecurso(dataRecebimento);

    console.log(`Definindo prazo de 5 dias úteis: ${prazoRecurso}`);
    
    const avaliacaoAtualizada = await prisma.avaliacao.update({
      where: { id: parseInt(id) },
      data: {
        status: 'AGUARDANDO_RECURSO',
        prazoRecurso: prazoRecurso,
        recursoExpirado: false 
      },
    });

    console.log(`✅ Avaliação ${id} devolvida com prazo até: ${prazoRecurso}`);

    res.json({ 
      success: true, 
      avaliacao: avaliacaoAtualizada,
      prazoRecurso: prazoRecurso 
    });
  } catch (error) {
    console.error("Erro ao devolver avaliação:", error);
    res.status(500).json({ error: 'Ocorreu um erro ao tentar devolver a avaliação.' });
  }
});

// ROTA PARA A SECRETARIA ENVIAR O RECURSO DE UMA AVALIAÇÃO
app.post('/api/avaliacoes/:id/recurso', authenticateToken, async (req, res) => {
    try {
        const { id: avaliacaoId } = req.params;
        const respostasDoRecurso = req.body.respostas; 
        const userId = req.user.userId;
        
        const user = await prisma.user.findUnique({ 
            where: { id: userId }, 
            select: { secretariaId: true } 
        });
        
        const avaliacao = await prisma.avaliacao.findUnique({ 
            where: { id: parseInt(avaliacaoId) }, 
            include: {
                respostas: {
                    include: {
                        requisito: true
                    }
                }
            }
        });

        if (!avaliacao || avaliacao.secretariaId !== user.secretariaId) {
            return res.status(403).json({ error: "Acesso negado. Você não tem permissão para editar esta avaliação." });
        }

        if (!respostasDoRecurso || respostasDoRecurso.length === 0) {
            console.log('📝 Recurso de confirmação total recebido - usuário concorda com todas as análises da SCGE');
            
            await prisma.avaliacao.update({
                where: { id: parseInt(avaliacaoId) },
                data: { status: 'EM_ANALISE_DE_RECURSO' }
            });

            console.log(`✅ Avaliação ${avaliacaoId} movida para EM_ANALISE_DE_RECURSO (confirmação total)`);
            
            return res.json({ 
                success: true, 
                message: "Confirmação de aceitação enviada com sucesso!",
                tipo: "confirmacao_total"
            });
        }

        const updates = [];
        
        for (const respostaRecurso of respostasDoRecurso) {
            const respostaOriginal = avaliacao.respostas.find(r => r.id === respostaRecurso.respostaId);
            if (!respostaOriginal) continue;

            let updateData = {
                comentarioRecurso: respostaRecurso.comentarioRecurso,
                linkComprovanteRecurso: respostaRecurso.linkComprovanteRecurso || null,
                statusRecurso: 'pendente',
                evidencias: {
                    create: respostaRecurso.evidencias ? respostaRecurso.evidencias.map(ev => ({
                        tipo: "recurso", 
                        url: ev.url
                    })) : []
                }
            };

            updateData.recursoAtende = respostaRecurso.recursoAtende;
            
            if (respostaRecurso.recursoAtende !== respostaOriginal.atendeOriginal) {
                updateData.atende = respostaRecurso.recursoAtende;
            }
            
            console.log(`   Recurso - ID: ${respostaRecurso.respostaId}`);
            console.log(`   Original: ${respostaOriginal.atendeOriginal}`);
            console.log(`   Recurso: ${respostaRecurso.recursoAtende}`);
            console.log(`   Atende atualizado: ${updateData.atende}`);

            updates.push(
                prisma.resposta.update({
                    where: { id: respostaRecurso.respostaId },
                    data: updateData
                })
            );
        }
        
        await prisma.$transaction(updates);

        await prisma.avaliacao.update({
            where: { id: parseInt(avaliacaoId) },
            data: { status: 'EM_ANALISE_DE_RECURSO' }
        });

        res.json({ 
            success: true, 
            message: "Recurso enviado com sucesso!",
            tipo: "recurso_com_alteracoes"
        });

    } catch (error) {
        console.error("Erro ao enviar recurso:", error);
        res.status(500).json({ error: 'Ocorreu um erro ao processar seu recurso.' });
    }
});

// ROTA ATUALIZADA PARA FINALIZAR AVALIAÇÃO COM LOGS E EMAIL DE NOTIFICAÇÃO
app.post('/api/avaliacoes/:id/finalizar', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id: avaliacaoId } = req.params;

        console.log(`\n--- [FINALIZAR LOG] Iniciando finalização da avaliação ID: ${avaliacaoId} ---`);

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(avaliacaoId) },
            include: {
                respostas: {
                    include: {
                        requisito: true,
                        evidencias: true
                    },
                    orderBy: { requisitoId: 'asc' }
                },
                secretaria: true
            },
        });

        if (!avaliacao) {
            console.error(`[FINALIZAR LOG] Erro: Avaliação ${avaliacaoId} não encontrada.`);
            return res.status(404).json({ error: 'Avaliação não encontrada.' });
        }

        console.log(`[FINALIZAR LOG] Avaliação ${avaliacaoId} encontrada para ${avaliacao.secretaria.sigla}. Calculando notas...`);

        let pontuacaoAutoavaliacao = 0;
        let pontuacaoPrimeiraAnalise = 0;
        let pontuacaoPosRecurso = 0;
        let pontuacaoFinal = 0;
        let pontuacaoTotal = 0;

        if (avaliacao.pontuacaoPosRecurso !== null && avaliacao.pontuacaoPosRecurso !== undefined) {
            console.log(`📊 Usando nota pós-recurso já salva do recurso: ${avaliacao.pontuacaoPosRecurso}`);
            pontuacaoPosRecurso = avaliacao.pontuacaoPosRecurso;
        } 
        else {
            console.log('🔄 Calculando nota pós-recurso com lógica avançada...');
            pontuacaoPosRecurso = 0;
        }

        // Dentro da rota de finalizar, substitua o loop de cálculo
        for (const resposta of avaliacao.respostas) { 
          const pontuacaoRequisito = resposta.requisito?.pontuacao || 0;
          pontuacaoTotal += pontuacaoRequisito;
          const analiseFinal = resposta.analiseFinal || {};

          if (resposta.subRespostas && resposta.subRespostas.length > 0) {
            const subAprovados = resposta.subRespostas.filter(s => {
              const statusFinal = s.statusValidacaoPosRecurso || s.statusValidacao;
              return statusFinal === 'aprovado';
            }).length;
            
            const pontuacaoProporcional = (subAprovados / resposta.subRespostas.length) * pontuacaoRequisito;
            
            if (resposta.atendeOriginal === true) {
              pontuacaoAutoavaliacao += pontuacaoRequisito;
            }
            
            pontuacaoFinal += Math.round(pontuacaoProporcional);
            
            console.log(`  📊 Requisito composto: ${subAprovados}/${resposta.subRespostas.length} aprovados → ${Math.round(pontuacaoProporcional)}/${pontuacaoRequisito} pts`);
            
          } else {
            if (resposta.atendeOriginal === true) {
              pontuacaoAutoavaliacao += pontuacaoRequisito;
            }

            if (resposta.statusValidacao === 'aprovado') {
              pontuacaoPrimeiraAnalise += pontuacaoRequisito;
            }

            if (avaliacao.pontuacaoPosRecurso === null || avaliacao.pontuacaoPosRecurso === undefined) {
              let pontuacaoRequisitoPosRecurso = 0;
              const teveRecurso = resposta.recursoAtende !== null ||
                                  resposta.comentarioRecurso ||
                                  (Array.isArray(resposta.evidencias) && resposta.evidencias.some(e => e.tipo === 'recurso'));

              if (teveRecurso) {
                const statusFinalConsiderado = analiseFinal.statusValidacaoPosRecurso || resposta.statusValidacao;
                if (statusFinalConsiderado === 'aprovado') {
                  pontuacaoRequisitoPosRecurso = pontuacaoRequisito;
                }
              } else {
                if (resposta.statusValidacao === 'aprovado') {
                  pontuacaoRequisitoPosRecurso = pontuacaoRequisito;
                }
              }
              pontuacaoPosRecurso += pontuacaoRequisitoPosRecurso;
            }

            const statusFinalConsiderado = analiseFinal.statusValidacaoPosRecurso || resposta.statusValidacao;
            if (statusFinalConsiderado === 'aprovado') {
              pontuacaoFinal += pontuacaoRequisito;
            }
          }
        } 

        if (avaliacao.pontuacaoPosRecurso === null || avaliacao.pontuacaoPosRecurso === undefined) {
            pontuacaoPosRecurso = Math.round(pontuacaoPosRecurso);
        }

        console.log(`\n[FINALIZAR LOG] Totais calculados FINAIS: Auto=${pontuacaoAutoavaliacao}, 1ª Análise=${pontuacaoPrimeiraAnalise}, Pós-Recurso=${pontuacaoPosRecurso}, Final=${pontuacaoFinal}, Total Possível=${pontuacaoTotal}`);

        const avaliacaoFinalizada = await prisma.avaliacao.update({
            where: { id: parseInt(avaliacaoId) },
            data: {
                status: 'FINALIZADA',
                pontuacaoFinal: Math.round(pontuacaoFinal),
                pontuacaoAutoavaliacao: Math.round(pontuacaoAutoavaliacao),
                pontuacaoPrimeiraAnalise: Math.round(pontuacaoPrimeiraAnalise),
                pontuacaoPosRecurso: pontuacaoPosRecurso,
                pontuacaoTotal: pontuacaoTotal,
                dataFinalizacao: new Date()
            },
            include: {
                secretaria: true 
            }
        });

        console.log(`[FINALIZAR LOG] ✅ Avaliação ${avaliacaoId} marcada como FINALIZADA e notas salvas no banco.`);

        try {
            await enviarEmailNotaFinal(avaliacaoFinalizada);
            console.log(`[FINALIZAR LOG] ✅ Email de notificação final enviado para ${avaliacaoFinalizada.emailResponsavel}.`);
        } catch (emailError) {
            console.warn(`[FINALIZAR LOG] ⚠️ ATENÇÃO: Avaliação finalizada com sucesso, MAS falha ao enviar email de notificação final: ${emailError.message}`);
        }

        res.json({
            success: true,
            message: 'Avaliação finalizada e notas publicadas com sucesso.',
            avaliacao: avaliacaoFinalizada,
            notas: {
                autoavaliacao: Math.round(pontuacaoAutoavaliacao),
                primeiraAnalise: Math.round(pontuacaoPrimeiraAnalise),
                posRecurso: pontuacaoPosRecurso, 
                final: Math.round(pontuacaoFinal),
                total: pontuacaoTotal
            }
        });

    } catch (error) {
        console.error(`[FINALIZAR LOG] ❌ Erro crítico ao finalizar avaliação ${avaliacaoId}:`, error);
        res.status(500).json({ error: 'Ocorreu um erro interno ao tentar finalizar a avaliação.', details: error.message });
    }
});

// NOVA ROTA - Salvar nota pós-recurso quando o recurso é enviado
app.patch('/api/avaliacoes/:id/nota-pos-recurso', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { pontuacaoPosRecurso } = req.body;

        console.log(`💾 Salvando nota pós-recurso: ${pontuacaoPosRecurso} para avaliação ${id}`);

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(id) },
            include: { secretaria: true }
        });

        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.userId }
        });

        if (user.secretariaId !== avaliacao.secretariaId && user.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Sem permissão para atualizar esta avaliação' });
        }

        const avaliacaoAtualizada = await prisma.avaliacao.update({
            where: { id: parseInt(id) },
            data: {
                pontuacaoPosRecurso: Math.round(pontuacaoPosRecurso)
            }
        });

        console.log(`✅ Nota pós-recurso salva com sucesso: ${avaliacaoAtualizada.pontuacaoPosRecurso}`);
        res.json({ 
            success: true, 
            pontuacaoPosRecurso: avaliacaoAtualizada.pontuacaoPosRecurso,
            message: 'Nota pós-recurso salva com sucesso'
        });

    } catch (error) {
        console.error('❌ Erro ao salvar nota pós-recurso:', error);
        res.status(500).json({ error: 'Erro interno ao salvar nota pós-recurso' });
    }
});

// ROTA CORRIGIDA PARA ENVIAR RELATÓRIO POR EMAIL
app.post('/api/enviar-relatorio-email', upload.single('relatorioPdf'), async (req, res) => {
  try {
    const { email, avaliacaoId } = req.body;
    const pdfBuffer = req.file?.buffer;

    console.log(`[EMAIL] Recebida solicitação para enviar relatório para: ${email}, Avaliação: ${avaliacaoId}`);
    
    if (!email || !avaliacaoId || !pdfBuffer) {
      console.log('[EMAIL] Dados incompletos:', { email, avaliacaoId, pdfBuffer: !!pdfBuffer });
      return res.status(400).json({ 
        error: 'Dados incompletos: email, avaliacaoId e PDF são obrigatórios' 
      });
    }

    const avaliacao = await prisma.avaliacao.findUnique({
      where: { id: parseInt(avaliacaoId) },
      include: {
        secretaria: true,
        respostas: {
          include: {
            requisito: true,
          },
        },
      },
    });

    if (!avaliacao) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }

    const pontuacaoFinal = avaliacao.pontuacaoFinal || calcularPontuacaoFinal(avaliacao.respostas);

    const percentual = (pontuacaoFinal / 180) * 100; 
    let mensagemDestaque = '';
    
    if (percentual === 100) {
      mensagemDestaque = 'PARABÉNS! EXCELÊNCIA TOTAL! Sua secretaria atingiu a pontuação máxima';
    } else if (percentual >= 90 && percentual < 100) {
      mensagemDestaque = 'ÓTIMO DESEMPENHO! Sua secretaria atingiu uma pontuação destacada';
    } else if (percentual >= 70 && percentual < 90) {
      mensagemDestaque = 'DESEMPENHO SATISFATÓRIO. Continue investindo em melhorias';
    } else if (percentual >= 1 && percentual < 70) {
      mensagemDestaque = 'OPORTUNIDADE DE MELHORIA. Sua secretaria precisa focar em corrigir os requisitos que não atende';
    } else {
      mensagemDestaque = 'DESEMPENHO CRÍTICO. É fundamental uma ação imediata.';
    }

    const mailOptions = {
      from: `"Controladoria Geral do Estado - PE" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Relatório Final de Avaliação - ${avaliacao.secretaria.sigla} - Ciclo 2025`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                .header { background: #002776; color: white; padding: 25px; text-align: center; }
                .content { padding: 25px; background: #f9f9f9; }
                .footer { background: #e9ecef; padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .destaque { background: #e8f5e8; padding: 20px; border-left: 4px solid #28a745; margin: 20px 0; border-radius: 4px; }
                .badge { display: inline-block; padding: 8px 16px; border-radius: 20px; color: white; font-weight: bold; font-size: 1.1em; }
                .aprovado { background: #28a745; }
                .reprovado { background: #dc3545; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 15px 0; }
                .info-item { background: white; padding: 10px; border-radius: 4px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Governo de Pernambuco</h1>
                <h2>Controladoria Geral do Estado</h2>
            </div>
            
            <div class="content">
                <h3>Prezado(a) Responsável,</h3>
                
                <p>Conforme previsto no <strong>Ciclo de Avaliação 2025 da Transparência Ativa</strong>, encaminhamos o relatório final de avaliação referente à sua secretaria.</p>
                
                <div class="destaque">
                    <h4>Resumo da Avaliação</h4>
                    <div class="info-grid">
                        <div class="info-item">
                            <strong>Órgão:</strong><br>
                            ${avaliacao.secretaria.nome} (${avaliacao.secretaria.sigla})
                        </div>
                        <div class="info-item">
                            <strong>Nota Final:</strong><br>
                            <span class="badge ${pontuacaoFinal > 140 ? 'aprovado' : 'reprovado'}">${pontuacaoFinal} pontos</span>
                        </div>
                    </div>
                    <div class="info-grid">
                        <div class="info-item">
                            <strong>Data de Finalização:</strong><br>
                            ${new Date(avaliacao.updatedAt).toLocaleDateString('pt-BR')}
                        </div>
                        <div class="info-item">
                            <strong>Status:</strong><br>
                            ${mensagemDestaque.split('!')[0]}!
                        </div>
                    </div>
                </div>
                
                <p><strong>O relatório detalhado em anexo contém:</strong></p>
                <ul>
                    <li>Evolução da pontuação durante as fases da avaliação</li>
                    <li>Análise detalhada de cada requisito avaliado</li>
                    <li>Resultados da autoavaliação, análise SCGE e recursos</li>
                    <li>Evidências e comentários dos analistas</li>
                </ul>
                
                <p>Este relatório constitui-se como documento oficial do processo de avaliação. Em caso de dúvidas ou necessidade de esclarecimentos adicionais, favor entrar em contato com nossa equipe através do email <strong>transparencia@scge.pe.gov.br</strong>.</p>
                
                <p>Atenciosamente,<br>
                  <strong>Equipe da Coordenação de Transparência Ativa (CTA) Controladoria Geral do Estado de Pernambuco</strong></p>
                  <strong>Secretaria da Controladoria-Geral do Estado de Pernambuco</strong></p>
            </div>
            
            <div class="footer">
                <p><em>Este é um email automático. Por favor, não responda diretamente a esta mensagem.</em></p>
                <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090 </p>
            </div>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: `relatorio-final-${avaliacao.secretaria.sigla}-${avaliacaoId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    console.log(`[EMAIL] Email enviado com sucesso para: ${email}`);
    
    res.json({ 
      success: true, 
      message: 'Relatório enviado por email com sucesso',
      destinatario: email
    });

  } catch (error) {
    console.error('[EMAIL] Erro ao enviar email:', error);
    res.status(500).json({ 
      error: 'Erro interno ao enviar email: ' + error.message 
    });
  }
});

// ROTA DE DEBUG SEM AUTENTICAÇÃO 
app.get('/api/debug/prazo-publico/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const avaliacao = await prisma.avaliacao.findUnique({
      where: { id: parseInt(id) }
    });

    if (!avaliacao) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }

    const agora = new Date();
    const prazo = new Date(avaliacao.prazoRecurso);
    const diferencaMs = prazo - agora;
    const segundosRestantes = Math.ceil(diferencaMs / 1000);

    res.json({
      avaliacaoId: parseInt(id),
      status: avaliacao.status,
      prazoRecurso: avaliacao.prazoRecurso,
      prazoFormatado: prazo.toLocaleString('pt-BR'),
      agora: agora.toLocaleString('pt-BR'),
      diferencaMs: diferencaMs,
      segundosRestantes: segundosRestantes,
      dentroDoPrazo: segundosRestantes > 0,
      recursoExpirado: avaliacao.recursoExpirado
    });
  } catch (error) {
    console.error('Erro no debug público:', error);
    res.status(500).json({ error: 'Erro no debug público' });
  }
});

// ROTA PARA ENVIAR EMAIL DE CONFIRMAÇÃO DE AVALIAÇÃO
app.post('/api/enviar-email-confirmacao', authenticateToken, async (req, res) => {
    try {
        const { email, nomeResponsavel, nomeSecretaria, urlSecretaria } = req.body;

        if (!email || !nomeResponsavel || !nomeSecretaria || !urlSecretaria) {
            return res.status(400).json({ error: 'Dados incompletos para envio do email.' });
        }

        const mailOptions = {
            from: `"Controladoria Geral do Estado - PE" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Confirmação de Recebimento - Avaliação de Transparência Ativa`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            line-height: 1.6; 
                            color: #333; 
                            max-width: 600px; 
                            margin: 0 auto;
                            background: #f5f5f5;
                        }
                        .email-container {
                            background: white;
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }
                        .header-img {
                            width: 100%;
                            max-width: 600px;
                            height: auto;
                            display: block;
                            object-fit: contain;
                        }
                        .content { 
                            padding: 30px; 
                        }
                        .footer { 
                            background: #e9ecef; 
                            padding: 20px; 
                            text-align: center; 
                            font-size: 12px; 
                            color: #666;
                        }
                        .info-box { 
                            background: white; 
                            border: 1px solid #ddd;
                            border-left: 4px solid #28a745;
                            border-radius: 6px;
                            padding: 20px;
                            margin: 15px 0;
                        }
                        .destaque { 
                            background: #e8f4fd; 
                            border: 1px solid #b3d9ff;
                            border-radius: 6px;
                            padding: 15px;
                            margin: 15px 0;
                        }
                        .badge { 
                            display: inline-block; 
                            padding: 6px 12px; 
                            border-radius: 15px; 
                            font-size: 0.8em;
                            font-weight: bold;
                        }
                        .analise { 
                            background: #17a2b8; 
                            color: white; 
                        }
                        .footer-images {
                            display: flex;
                            justify-content: center;
                            gap: 20px;
                            margin: 15px 0;
                            align-items: center;
                        }
                        .footer-img {
                            max-width: 150px;
                            height: 60px;
                            object-fit: contain;
                        }
                        .footer-img[alt="SIMPE"] {
                            max-width: 200px;
                            height: 80px;
                        }
                        h3 { color: #002776; margin-top: 0; }
                        h4 { color: #333; margin-top: 0; }
                    </style>
                </head>
                <body>
                    <div class="email-container">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                             alt="Controladoria Geral do Estado" 
                             class="header-img">
                        
                        <div class="content">
                            <h3>Confirmação de Recebimento</h3>
                            
                            <div class="destaque">
                                <p><strong>Sua avaliação de transparência ativa foi recebida com sucesso!</strong></p>
                            </div>
                            
                            <p>Prezado(a) <strong>${nomeResponsavel}</strong>,</p>
                            <p>Informamos que a sua avaliação de transparência ativa foi recebida pelo sistema e está em processamento.</p>
                            
                            <div class="info-box">
                                <h4>Detalhes da Avaliação</h4>
                                <p><strong>Órgão/Entidade:</strong> ${nomeSecretaria}</p>
                                <p><strong>URL Avaliada:</strong> ${urlSecretaria}</p>
                                <p><strong>Data do Envio:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
                                <p><strong>Status:</strong> <span class="badge analise">EM ANÁLISE PELA SCGE</span></p>
                            </div>
                            
                            <div class="info-box">
                                <h4>Próximos Passos</h4>
                                <ul>
                                    <li>Sua avaliação será analisada pela equipe da Controladoria Geral do Estado</li>
                                    <li>Em breve, você receberá notificações sobre o andamento do processo</li>
                                    <li>Em caso de necessidade de ajustes, entraremos em contato</li>
                                </ul>
                            </div>
                            
                            <p><strong>Acompanhamento:</strong></p>
                            <p>Você pode acompanhar o status da sua avaliação através do sistema, na sua área pessoal.</p>
                            
                            <p style="margin-top: 25px;">
                                Atenciosamente,<br>
                                <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                            </p>
                        </div>
                        
                        <div class="footer">
                            <p><em>Este é um email automático do Sistema de Avaliação de Transparência.</em></p>
                            <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                            R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                            
                            <div class="footer-images">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                                     alt="SIMPE" 
                                     class="footer-img">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                                     alt="Governo de Pernambuco" 
                                     class="footer-img">
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Email de confirmação enviado com sucesso',
            destinatario: email
        });

    } catch (error) {
        console.error('[EMAIL CONFIRMAÇÃO] Erro ao enviar email:', error);
        res.status(500).json({ 
            error: 'Erro interno ao enviar email de confirmação: ' + error.message 
        });
    }
});

app.post('/api/notificar-controladoria', authenticateToken, async (req, res) => {
    try {
        const { nomeResponsavel, emailResponsavel, nomeSecretaria, urlSecretaria, dataEnvio } = req.body;

        if (!nomeResponsavel || !emailResponsavel || !nomeSecretaria || !urlSecretaria) {
            return res.status(400).json({ error: 'Dados incompletos para notificação.' });
        }

        const mailOptions = {
            from: `"Sistema de Monitoramento - PE" <${process.env.SMTP_USER}>`,
            to: ['kadsonlima91@gmail.com',/*'transparencia@scge.pe.gov.br'*/],
            subject: `Nova Autoavaliação Recebida - ${nomeSecretaria}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            line-height: 1.6; 
                            color: #333; 
                            max-width: 600px; 
                            margin: 0 auto;
                            background: #f5f5f5;
                        }
                        .email-container {
                            background: white;
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }
                        .header-img {
                            width: 100%;
                            max-width: 600px;
                            height: auto;
                            display: block;
                            object-fit: contain;
                        }
                        .content { 
                            padding: 25px; 
                        }
                        .footer { 
                            background: #e9ecef; 
                            padding: 20px; 
                            text-align: center; 
                            font-size: 12px; 
                            color: #666;
                        }
                        .info-box { 
                            background: white; 
                            border: 1px solid #ddd;
                            border-left: 4px solid #002776;
                            border-radius: 6px;
                            padding: 20px;
                            margin: 15px 0;
                        }
                        .destaque { 
                            background: #e8f4fd; 
                            border: 1px solid #b3d9ff;
                            border-radius: 6px;
                            padding: 15px;
                            margin: 15px 0;
                        }
                        .btn { 
                            background: #002776; 
                            color: #ffffff !important; 
                            padding: 12px 25px; 
                            text-decoration: none; 
                            border-radius: 6px; 
                            font-weight: bold;
                            display: inline-block;
                            margin: 10px 0;
                        }
                        .footer-images {
                            display: flex;
                            justify-content: center;
                            gap: 20px;
                            margin: 15px 0;
                            align-items: center;
                        }
                        .footer-img {
                            max-width: 150px;
                            height: 60px;
                            object-fit: contain;
                        }
                        .footer-img[alt="SIMPE"] {
                            max-width: 200px;
                            height: 80px;
                        }
                        h3 { color: #002776; }
                        h4 { color: #333; margin-top: 0; }
                    </style>
                </head>
                <body>
                    <div class="email-container">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                             alt="Controladoria Geral do Estado" 
                             class="header-img">
                        
                        <div class="content">
                            <h3>Nova Autoavaliação Recebida</h3>
                            
                            <div class="destaque">
                                <p><strong>Uma nova autoavaliação foi submetida no sistema.</strong></p>
                            </div>
                            
                            <div class="info-box">
                                <h4>Dados do Responsável</h4>
                                <p><strong>Nome:</strong> ${nomeResponsavel}</p>
                                <p><strong>Email:</strong> ${emailResponsavel}</p>
                                <p><strong>Data do Envio:</strong> ${dataEnvio || new Date().toLocaleDateString('pt-BR')}</p>
                            </div>
                            
                            <div class="info-box">
                                <h4>Dados da Secretaria</h4>
                                <p><strong>Órgão/Entidade:</strong> ${nomeSecretaria}</p>
                                <p><strong>URL Avaliada:</strong> ${urlSecretaria}</p>
                            </div>
                            
                            <p><strong>Ações Necessárias:</strong></p>
                            <ul>
                                <li>Esta avaliação está com status <strong>EM ANÁLISE PELA SCGE</strong></li>
                                <li>Acesse o sistema administrativo para iniciar a análise</li>
                            </ul>
                            
                            <p style="margin-top: 25px; text-align: center;">
                                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" 
                                   class="btn" style="color: #ffffff !important;">
                                   Acessar Área Administrativa
                                </a>
                            </p>
                            
                            <p style="margin-top: 15px;">
                                Atenciosamente,<br>
                                <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                            </p>
                        </div>
                        
                        <div class="footer">
                            <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                            <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                            R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                            
                            <div class="footer-images">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                                     alt="SIMPE" 
                                     class="footer-img">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                                     alt="Governo de Pernambuco" 
                                     class="footer-img">
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Controladoria notificada com sucesso'
        });

    } catch (error) {
        console.error('[NOTIFICAÇÃO CONTROLADORIA] Erro ao enviar email:', error);
        res.status(500).json({ 
            error: 'Erro interno ao notificar controladoria: ' + error.message 
        });
    }
});

// ROTA PARA NOTIFICAR A CONTROLADORIA SOBRE RECURSO ENVIADO
app.post('/api/avaliacoes/:id/notificar-recurso', authenticateToken, async (req, res) => {
    try {
        const { id: avaliacaoId } = req.params;
        const userId = req.user.userId;

        const avaliacao = await prisma.avaliacao.findUnique({
            where: { id: parseInt(avaliacaoId) },
            include: {
                secretaria: true,
                respostas: {
                    include: {
                        requisito: true
                    }
                }
            }
        });

        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada.' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { secretariaId: true }
        });

        if (avaliacao.secretariaId !== user.secretariaId) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const requisitosComRecurso = avaliacao.respostas.filter(resposta => 
            resposta.comentarioRecurso || 
            resposta.atende !== resposta.atendeOriginal ||
            resposta.atendeDisponibilidade !== resposta.atendeDisponibilidadeOriginal ||
            resposta.atendeSerieHistorica !== resposta.atendeSerieHistoricaOriginal
        ).length;

        const mailOptions = {
            from: `"Sistema de Monitoramento - PE" <${process.env.SMTP_USER}>`,
            to: ['kadsonlima91@gmail.com' , /*'transparencia@scge.pe.gov.br'*/],
            subject: `Recurso Recebido - ${avaliacao.secretaria.sigla} - Ciclo 2025`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            line-height: 1.6; 
                            color: #333; 
                            max-width: 600px; 
                            margin: 0 auto;
                            background: #f5f5f5;
                        }
                        .email-container {
                            background: white;
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }
                        .header-img {
                            width: 100%;
                            max-width: 600px;
                            height: auto;
                            display: block;
                            object-fit: contain;
                        }
                        .content { 
                            padding: 25px; 
                        }
                        .footer { 
                            background: #e9ecef; 
                            padding: 20px; 
                            text-align: center; 
                            font-size: 12px; 
                            color: #666;
                        }
                        .info-box { 
                            background: white; 
                            border: 1px solid #ddd;
                            border-left: 4px solid #6f42c1;
                            border-radius: 6px;
                            padding: 20px;
                            margin: 15px 0;
                        }
                        .destaque { 
                            background: #f0e6ff; 
                            border: 1px solid #d9c8ff;
                            border-radius: 6px;
                            padding: 15px;
                            margin: 15px 0;
                        }
                        .badge { 
                            display: inline-block; 
                            padding: 6px 12px; 
                            border-radius: 15px; 
                            font-size: 0.8em;
                            font-weight: bold;
                        }
                        .recurso { 
                            background: #6f42c1; 
                            color: white; 
                        }
                        .btn { 
                            background: #6f42c1; 
                            color: #ffffff !important; 
                            padding: 12px 25px; 
                            text-decoration: none; 
                            border-radius: 6px; 
                            font-weight: bold;
                            display: inline-block;
                            margin: 10px 0;
                        }
                        .footer-images {
                            display: flex;
                            justify-content: center;
                            gap: 20px;
                            margin: 15px 0;
                            align-items: center;
                        }
                        .footer-img {
                            max-width: 150px;
                            height: 60px;
                            object-fit: contain;
                        }
                        .footer-img[alt="SIMPE"] {
                            max-width: 200px;
                            height: 80px;
                        }
                        h3 { color: #002776; }
                        h4 { color: #333; margin-top: 0; }
                    </style>
                </head>
                <body>
                    <div class="email-container">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                             alt="Controladoria Geral do Estado" 
                             class="header-img">
                        
                        <div class="content">
                            <h3>Nova Solicitação de Recurso Recebida</h3>
                            
                            <div class="destaque">
                                <p><strong>A secretaria ${avaliacao.secretaria.nome} enviou um recurso para reanálise.</strong></p>
                            </div>
                            
                            <div class="info-box">
                                <h4>Detalhes do Recurso</h4>
                                <p><strong>Órgão/Entidade:</strong> ${avaliacao.secretaria.nome} (${avaliacao.secretaria.sigla})</p>
                                <p><strong>URL Avaliada:</strong> ${avaliacao.urlSecretaria}</p>
                                <p><strong>Data do Recurso:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
                                <p><strong>Requisitos com Recurso:</strong> ${requisitosComRecurso} de ${avaliacao.respostas.length}</p>
                                <p><strong>Status:</strong> <span class="badge recurso">EM ANÁLISE DE RECURSO</span></p>
                            </div>
                            
                            <div class="info-box">
                                <h4>Informações do Processo</h4>
                                <p><strong>ID da Avaliação:</strong> ${avaliacaoId}</p>
                                <p><strong>Responsável pelo Recurso:</strong> ${avaliacao.nomeResponsavel}</p>
                                <p><strong>Email do Responsável:</strong> ${avaliacao.emailResponsavel}</p>
                            </div>
                            
                            <p><strong>Ações Necessárias:</strong></p>
                            <ul>
                                <li>Esta avaliação está aguardando <strong>análise do recurso</strong></li>
                                <li>Acesse o sistema administrativo para revisar as alterações solicitadas</li>
                                <li>Verifique os comentários e novas evidências fornecidas pela secretaria</li>
                            </ul>
                            
                            <p style="margin-top: 25px; text-align: center;">
                                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin" 
                                  class="btn" style="color: #ffffff !important;">
                                  Acessar Área Administrativa
                                </a>
                            </p>
                            
                            <p style="margin-top: 15px;">
                                Atenciosamente,<br>
                                <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                            </p>
                        </div>
                        
                        <div class="footer">
                            <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                            <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                            R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                            
                            <div class="footer-images">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                                     alt="SIMPE" 
                                     class="footer-img">
                                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                                     alt="Governo de Pernambuco" 
                                     class="footer-img">
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);
        
        console.log(`[EMAIL RECURSO] Notificação enviada para a controladoria sobre recurso da avaliação ${avaliacaoId}`);
        
        res.json({ 
            success: true, 
            message: 'Controladoria notificada sobre o recurso enviado',
            requisitosComRecurso: requisitosComRecurso
        });

    } catch (error) {
        console.error('[EMAIL RECURSO] Erro ao enviar notificação de recurso:', error);
        res.status(500).json({ 
            error: 'Erro interno ao notificar controladoria sobre recurso: ' + error.message 
        });
    }
});

app.post('/api/avaliacoes/:id/notificar-devolucao-recurso', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
      const { id: avaliacaoId } = req.params;

      const avaliacao = await prisma.avaliacao.findUnique({
        where: { id: parseInt(avaliacaoId) },
        include: {
          secretaria: true,
          respostas: {
            include: {
              requisito: true
            }
          }
        }
      });

      if (!avaliacao) {
        return res.status(404).json({ error: 'Avaliação não encontrada.' });
      }

      let pontuacaoAtual = 0; 
      let pontuacaoTotal = 0;

      avaliacao.respostas.forEach(resposta => {
        const pontuacaoRequisito = resposta.requisito.pontuacao;
        pontuacaoTotal += pontuacaoRequisito;

        if (resposta.statusValidacao === 'aprovado') {
            pontuacaoAtual += pontuacaoRequisito;
        }
      });

      pontuacaoAtual = Math.round(pontuacaoAtual); 

    function calcularPrazoRecurso(dataInicio) {
      let data = new Date(dataInicio);
      let diasUteis = 0;
      const diasNecessarios = 5;
      
      data.setDate(data.getDate() + 1);
      data.setHours(0, 0, 1, 0);
      
      let diaSemana = data.getDay();
      if (diaSemana === 0) { 
        data.setDate(data.getDate() + 1); 
      } else if (diaSemana === 6) { 
        data.setDate(data.getDate() + 2); 
      }
      
      while (diasUteis < diasNecessarios) {
        data.setDate(data.getDate() + 1);
        diaSemana = data.getDay();
        if (diaSemana !== 0 && diaSemana !== 6) {
          diasUteis++;
        }
      }
      
      data.setHours(23, 59, 59, 0);
      
      return data;
    }

    const prazoRecurso = calcularPrazoRecurso(new Date()); 

      await prisma.avaliacao.update({
          where: { id: parseInt(avaliacaoId) },
          data: { prazoRecurso: prazoRecurso }
      });

      const mailOptions = {
          from: `"Controladoria Geral do Estado - PE" <${process.env.SMTP_USER}>`,
          to: avaliacao.emailResponsavel, 
          subject: `Avaliação Devolvida para Recurso - ${avaliacao.secretaria.sigla} - Ciclo 2025`,
          html: `
              <!DOCTYPE html>
              <html>
              <head>
                  <meta charset="utf-8">
                  <style>
                      body { 
                          font-family: Arial, sans-serif; 
                          line-height: 1.6; 
                          color: #333; 
                          max-width: 600px; 
                          margin: 0 auto;
                          background: #f5f5f5;
                      }
                      .email-container {
                          background: white;
                          border-radius: 8px;
                          overflow: hidden;
                          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                      }
                      .header-img {
                          width: 100%;
                          max-width: 600px;
                          height: auto;
                          display: block;
                          object-fit: contain;
                      }
                      .content { 
                          padding: 25px; 
                      }
                      .footer { 
                          background: #e9ecef; 
                          padding: 20px; 
                          text-align: center; 
                          font-size: 12px; 
                          color: #666;
                      }
                      .info-box { 
                          background: white; 
                          border: 1px solid #ddd;
                          border-radius: 6px;
                          padding: 20px;
                          margin: 15px 0;
                      }
                      .destaque { 
                          background: #fff3cd; 
                          border: 1px solid #ffeaa7;
                          border-radius: 6px;
                          padding: 15px;
                          margin: 15px 0;
                      }
                      .badge { 
                          display: inline-block; 
                          padding: 6px 12px; 
                          border-radius: 15px; 
                          font-size: 0.8em;
                          font-weight: bold;
                      }
                      .recurso { 
                          background: #ffc107; 
                          color: #333; 
                      }
                      .btn { 
                          background: #002776; 
                          color: #ffffff !important; 
                          padding: 12px 25px; 
                          text-decoration: none; 
                          border-radius: 6px; 
                          font-weight: bold;
                          display: inline-block;
                          margin: 10px 0;
                      }
                      .footer-images {
                          display: flex;
                          justify-content: center;
                          gap: 20px;
                          margin: 15px 0;
                          align-items: center;
                      }
                      .footer-img {
                          max-width: 150px;
                          height: 60px;
                          object-fit: contain;
                      }
                      .footer-img[alt="SIMPE"] {
                          max-width: 200px;
                          height: 80px;
                      }
                      h3 { color: #002776; }
                      h4 { color: #333; margin-top: 0; }
                  </style>
              </head>
              <body>
                  <div class="email-container">
                      <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                           alt="Controladoria Geral do Estado" 
                           class="header-img">
                      
                      <div class="content">
                          <h3>Avaliação Devolvida para Recurso</h3>
                          
                          <div class="destaque">
                              <p><strong>Sua avaliação foi analisada pela SCGE e está disponível para recurso.</strong></p>
                          </div>
                          
                          <div class="info-box">
                              <h4>Resumo da Avaliação</h4>
                              <p><strong>Órgão/Entidade:</strong> ${avaliacao.secretaria.nome} (${avaliacao.secretaria.sigla})</p>
                              <p><strong>URL Avaliada:</strong> ${avaliacao.urlSecretaria}</p>
                              <p><strong>Nota Atual (SCGE):</strong> ${pontuacaoAtual} / ${pontuacaoTotal} pontos</p>
                              <p><strong>Status:</strong> <span class="badge recurso">AGUARDANDO RECURSO</span></p>
                              <p><strong>Data da Devolução:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
                          </div>
                          
                          <div class="info-box">
                              <h4>Próximos Passos</h4>
                              <p><strong>Você tem a oportunidade de interpor recurso sobre os itens divergentes.</strong></p>
                              <p><strong>Prazo para recurso:</strong> 5 dias úteis (até ${prazoRecurso.toLocaleDateString('pt-BR')} às 23:59:59)</p>
                              <p style="font-size: 0.9em; color: #666;">
                                  ⚠️ O prazo exato de expiração será mostrado no sistema.
                              </p>
                              <ul>
                                  <li>Acesse o sistema para verificar a análise detalhada da SCGE</li>
                                  <li>Verifique os comentários e justificativas dos analistas</li>
                                  <li>Envie novas evidências ou argumentos para os requisitos em discordância</li>
                              </ul>
                          </div>
                          
                          <p style="margin-top: 25px; text-align: center;">
                              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/avaliacao-usuario/${avaliacaoId}" 
                                class="btn" style="color: #ffffff !important;">
                                Acessar Sistema para Recurso
                              </a>
                          </p>
                          
                          <p style="margin-top: 15px;">
                              Atenciosamente,<br>
                              <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong></p>
                          </p>
                      </div>
                      
                      <div class="footer">
                          <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                          <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                          R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                          
                          <div class="footer-images">
                              <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                                   alt="SIMPE" 
                                   class="footer-img">
                              <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                                   alt="Governo de Pernambuco" 
                                   class="footer-img">
                          </div>
                      </div>
                  </div>
              </body>
              </html>
            `
      };

      await transporter.sendMail(mailOptions);
      
      console.log(`[EMAIL DEVOLUÇÃO] Email enviado para ${avaliacao.emailResponsavel} sobre devolução para recurso da avaliação ${avaliacaoId}`);
      
      res.json({ 
          success: true, 
          message: 'Secretaria notificada sobre a devolução para recurso',
          destinatario: avaliacao.emailResponsavel,
          pontuacaoAtual: pontuacaoAtual, 
          pontuacaoTotal: pontuacaoTotal,
          prazoRecurso: prazoRecurso 
      });

    } catch (error) {
      console.error('[EMAIL DEVOLUÇÃO] Erro ao enviar email de devolução:', error);
      res.status(500).json({ 
          error: 'Erro interno ao notificar secretaria sobre devolução: ' + error.message 
      });
    }
});

// ROTA MELHORADA PARA VERIFICAR PRAZO DO RECURSO
app.get('/api/avaliacoes/:id/verificar-prazo-recurso', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const avaliacao = await prisma.avaliacao.findUnique({
      where: { id: parseInt(id) }
    });

    if (!avaliacao) {
      return res.status(404).json({ error: 'Avaliação não encontrada' });
    }

    if (!avaliacao.prazoRecurso) {
      return res.json({ 
        dentroDoPrazo: false, 
        mensagem: 'Prazo não definido',
        dataLimite: null,
        segundosRestantes: 0
      });
    }

    const agora = new Date();
    const dataLimite = new Date(avaliacao.prazoRecurso);
    const dentroDoPrazo = agora <= dataLimite;
    
    const segundosRestantes = Math.max(0, Math.ceil((dataLimite - agora) / 1000));

    res.json({ 
      dentroDoPrazo, 
      segundosRestantes: dentroDoPrazo ? segundosRestantes : 0,
      dataLimite: avaliacao.prazoRecurso,
      recursoExpirado: avaliacao.recursoExpirado
    });
  } catch (error) {
    console.error('Erro ao verificar prazo:', error);
    res.status(500).json({ error: 'Erro ao verificar prazo' });
  }
});

function calcularPontuacaoFinal(respostas) {
  let pontuacaoFinal = 0;
  
  respostas.forEach(resposta => {
    const pontuacaoRequisito = resposta.requisito.pontuacao;
    const isSplit = resposta.atendeDisponibilidadeOriginal !== null;

    if (isSplit) {
      if (resposta.validacaoDisponibilidade === 'aprovado') pontuacaoFinal += pontuacaoRequisito / 2;
      if (resposta.validacaoSerieHistorica === 'aprovado') pontuacaoFinal += pontuacaoRequisito / 2;
    } else {
      if (resposta.statusValidacao === 'aprovado') pontuacaoFinal += pontuacaoRequisito;
    }
  });

  return Math.round(pontuacaoFinal);
}

// ROTA PARA SALVAR UMA NOVA AVALIAÇÃO COMPLETA 
app.post('/api/avaliacoes', authenticateToken, async (req, res) => {
    const { urlSecretaria, nomeResponsavel, emailResponsavel, respostas, subitens } = req.body;
    const userId = req.user.userId;

    console.log('=== INICIANDO SALVAMENTO DE AVALIAÇÃO ===');
    console.log('Dados recebidos:', {
        urlSecretaria,
        nomeResponsavel,
        emailResponsavel,
        totalRespostas: respostas ? respostas.length : 0,
        totalSubitens: subitens ? subitens.length : 0
    });

    try {
        if (!urlSecretaria || !nomeResponsavel || !emailResponsavel) {
            return res.status(400).json({ error: 'Dados obrigatórios faltando.' });
        }

        if (!respostas || !Array.isArray(respostas) || respostas.length === 0) {
            return res.status(400).json({ error: 'Nenhuma resposta fornecida.' });
        }

        const user = await prisma.user.findUnique({ 
            where: { id: userId } 
        });
        
        if (!user) { 
            console.log('❌ Usuário não encontrado:', userId);
            return res.status(404).json({ error: "Usuário não encontrado." }); 
        }

        console.log('✅ Usuário encontrado. Secretaria ID:', user.secretariaId);

        const avaliacaoCriada = await prisma.avaliacao.create({
            data: {
                secretariaId: user.secretariaId, 
                urlSecretaria: urlSecretaria,
                nomeResponsavel: nomeResponsavel,
                emailResponsavel: emailResponsavel,
                status: 'EM_ANALISE_SCGE',
                ciclo: 2025,
            }
        });

        console.log('✅ Avaliação base criada. ID:', avaliacaoCriada.id);

        const respostasCriadas = [];
        
        for (const resposta of respostas) {
            try {
                console.log('Criando resposta para requisito:', resposta.requisitoId);

                const respostaData = {
                    avaliacaoId: avaliacaoCriada.id,
                    requisitoId: resposta.requisitoId,
                    atende: resposta.atende ? true : false,
                    linkComprovante: resposta.linkComprovante || null,
                    linkComprovanteRecurso: null,
                    foiAutomatico: resposta.foiAutomatico ? true : false,
                    comentarioSecretaria: resposta.comentarioSecretaria || null,
                    atendeOriginal: resposta.atende ? true : false,
                    statusValidacao: "pendente"
                };

                const respostaCriada = await prisma.resposta.create({
                    data: respostaData
                });

                console.log(`✅ Resposta ${respostaCriada.id} criada para requisito ${resposta.requisitoId}`);

                if (resposta.evidencias && Array.isArray(resposta.evidencias) && resposta.evidencias.length > 0) {
                    console.log(`Criando ${resposta.evidencias.length} evidências para resposta ${respostaCriada.id}`);
                    
                    for (const evidencia of resposta.evidencias) {
                        if (evidencia.url && evidencia.url.trim() !== '') {
                            await prisma.evidencia.create({
                                data: {
                                    respostaId: respostaCriada.id,
                                    tipo: 'original',
                                    url: evidencia.url.trim()
                                }
                            });
                            console.log(`✅ Evidência criada: ${evidencia.url}`);
                        }
                    }
                }

                respostasCriadas.push(respostaCriada.id);

            } catch (error) {
                console.error(`❌ Erro ao criar resposta para requisito ${resposta.requisitoId}:`, error);
            }
        }

        if (subitens && Array.isArray(subitens) && subitens.length > 0) {
            console.log(`📝 Salvando ${subitens.length} subitens...`);
            
            const subitensPorRequisito = {};
            subitens.forEach(sub => {
                if (!subitensPorRequisito[sub.requisitoId]) {
                    subitensPorRequisito[sub.requisitoId] = [];
                }
                subitensPorRequisito[sub.requisitoId].push(sub);
            });
            
            for (const [requisitoId, listaSubitens] of Object.entries(subitensPorRequisito)) {
                const respostaIndex = respostas.findIndex(r => r.requisitoId === parseInt(requisitoId));
                
                if (respostaIndex !== -1) {
                    const respostaCriadaId = respostasCriadas[respostaIndex];
                    
                    console.log(`📌 Processando ${listaSubitens.length} subitens para resposta ${respostaCriadaId}`);
                    
                    for (const sub of listaSubitens) {
                        try {
                            if (!sub.subRequisitoId) {
                                console.warn(`⚠️ Subitem sem subRequisitoId ignorado:`, sub);
                                continue;
                            }
                            
                            const subResposta = await prisma.subResposta.create({
                                data: {
                                    respostaId: respostaCriadaId,
                                    subRequisitoId: sub.subRequisitoId,
                                    atende: sub.atende || false,
                                    linkComprovante: sub.linkComprovante || null,
                                    comentarioSecretaria: sub.comentario || null,
                                    statusValidacao: 'pendente'
                                }
                            });
                            
                            console.log(`  ✅ Subresposta ${subResposta.id} criada para subrequisito ${sub.subRequisitoId}`);
                            
                            if (sub.evidencias && Array.isArray(sub.evidencias) && sub.evidencias.length > 0) {
                                for (const ev of sub.evidencias) {
                                    if (ev.url && ev.url.trim() !== '') {
                                        await prisma.subEvidencia.create({
                                            data: {
                                                subRespostaId: subResposta.id,
                                                tipo: 'original',
                                                url: ev.url.trim()
                                            }
                                        });
                                    }
                                }
                                console.log(`    ✅ ${sub.evidencias.length} evidências criadas para subitem`);
                            }
                            
                        } catch (error) {
                            console.error(`❌ Erro ao criar subresposta:`, error);
                        }
                    }
                }
            }
            
            console.log(`✅ Todos os ${subitens.length} subitens processados`);
        } else {
            console.log('ℹ️ Nenhum subitem para salvar');
        }

        console.log(`✅ Processo concluído. ${respostasCriadas.length} respostas criadas.`);

        const avaliacaoCompleta = await prisma.avaliacao.findUnique({
            where: { id: avaliacaoCriada.id },
            include: { 
                secretaria: true,
                respostas: {
                    include: {
                        evidencias: true,
                        requisito: true,
                        subRespostas: {
                            include: {
                                subRequisito: true,
                                evidencias: true
                            }
                        }
                    },
                    orderBy: {
                        requisitoId: 'asc'
                    }
                } 
            },
        });

        console.log('✅ Avaliação final recuperada com sucesso');

        res.status(201).json(avaliacaoCompleta);

    } catch (error) {
        console.error('❌ ERRO CRÍTICO AO SALVAR AVALIAÇÃO:', error);
        
        console.error('Código do erro:', error.code);
        console.error('Mensagem do erro:', error.message);
        if (error.meta) {
            console.error('Meta do erro:', error.meta);
        }

        res.status(500).json({ 
            error: 'Ocorreu um erro ao salvar a avaliação no banco de dados.',
            details: error.message,
            code: error.code
        });
    }
});

// Rota para criar requisitos GLOBAIS (secretariaId = null)
app.post('/api/requisitos-globais', authenticateToken, authenticateAdmin, async (req, res) => {
    const { texto, pontuacao, textoAjuda } = req.body;

    if (!texto || !pontuacao) {
        return res.status(400).json({ error: 'Texto e pontuação são obrigatórios.' });
    }

    try {
        const novoRequisito = await prisma.requisito.create({
            data: {
                texto: texto,
                pontuacao: parseInt(pontuacao),
                secretariaId: null, // NULL = global
                textoAjuda: textoAjuda && textoAjuda.trim() !== "" ? textoAjuda : "Este é um requisito padrão para todos os órgãos."
            }
        });
        
        console.log(`[ADMIN] Requisito global criado: ID ${novoRequisito.id}`);
        res.status(201).json(novoRequisito);
        
    } catch (error) {
        console.error('Erro ao criar requisito global:', error);
        res.status(500).json({ error: "Erro ao criar o requisito global." });
    }
});

app.get('/api/debug-schema', async (req, res) => {
    try {
        console.log('=== VERIFICANDO SCHEMA DO BANCO ===');
        
        const totalAvaliacoes = await prisma.avaliacao.count();
        const totalRespostas = await prisma.resposta.count();
        const totalEvidencias = await prisma.evidencia.count();
        const totalRequisitos = await prisma.requisito.count();
        
        const exemploResposta = await prisma.resposta.findFirst({
            include: {
                evidencias: true,
                requisito: true
            }
        });
        
        res.json({
            totais: {
                avaliacoes: totalAvaliacoes,
                respostas: totalRespostas,
                evidencias: totalEvidencias,
                requisitos: totalRequisitos
            },
            exemploResposta: exemploResposta,
            status: 'Schema verificado'
        });
        
    } catch (error) {
        console.error('Erro ao verificar schema:', error);
        res.status(500).json({ error: 'Erro ao verificar schema' });
    }
});

// Parar uma varredura
app.post('/stop-crawl/:sessionId', authenticateToken, async (req, res) => {
  const { sessionId } = req.params;
  if (!activeProcesses.has(sessionId)) {
    try {
      await prisma.scanSession.update({ where: { id: sessionId, status: 'iniciado' }, data: { status: 'interrompido' } });
    } catch (error) {}
    return res.status(404).json({ message: 'Sessão não encontrada ou já finalizada.' });
  }
  try {
    const processInfo = activeProcesses.get(sessionId);
    processInfo.process.kill('SIGKILL');
    activeProcesses.delete(sessionId);
    await prisma.scanSession.update({ where: { id: sessionId }, data: { status: 'interrompido' } });
    res.json({ success: true, message: 'Varredura interrompida com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao parar varredura' });
  }
});

// Listar todas as avaliações
app.get('/api/avaliacoes', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { status } = req.query; 
        const whereClause = {}; 

        if (status) { 
            whereClause.status = status;
        }

        const avaliacoes = await prisma.avaliacao.findMany({
            where: whereClause, 
            orderBy: { createdAt: 'desc' },
            include: { 
                secretaria: { select: { nome: true, sigla: true } },
                respostas: true
            },
        });
        res.json(avaliacoes);

      } catch (error) {
        console.error("ERRO na rota /avaliacoes:", error); 
        res.status(500).json({ error: "Erro ao buscar a lista de avaliações." });
      }
});

// Buscar detalhes de uma avaliação
app.get('/api/avaliacoes/:id', authenticateToken, authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const avaliacao = await prisma.avaliacao.findUnique({
      where: { id: parseInt(id) },
      include: { 
        secretaria: true, 
        respostas: { 
          orderBy: { requisitoId: 'asc' }, 
          include: { 
            requisito: true, 
            evidencias: true, 
            linksAnalista: true, 
            linksAnaliseFinal: true,
            subRespostas: {
              include: {
                subRequisito: true,
                evidencias: true
              },
              orderBy: {
                subRequisito: {
                  ordem: 'asc'
                }
              }
            }
          } 
        } 
      },
    });
    if (!avaliacao) { return res.status(404).json({ error: "Avaliação não encontrada." }); }
    res.json(avaliacao);
  } catch (error) {
    console.error('Erro ao buscar avaliação:', error);
    res.status(500).json({ error: "Erro ao buscar detalhes da avaliação." });
  }
});

// Listar todas as sessões do scanner
app.get("/sessions", authenticateToken, async (req, res) => {
  try {
    const sessions = await prisma.scanSession.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar sessões" });
  }
});

app.get('/scan-stream/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); 

    const processInfo = activeProcesses.get(sessionId);

    if (!processInfo || !processInfo.process) {
        res.write('data: Erro: Sessão não encontrada ou já finalizada.\n\n');
        return res.end();
    }

    const process = processInfo.process;

    const logListener = (data) => {
        const logLines = data.toString().trim().split('\n');
        logLines.forEach(line => {
            res.write(`data: ${line}\n\n`);
        });
    };
    
    process.stdout.on('data', logListener);
    process.stderr.on('data', logListener);

    req.on('close', () => {
        process.stdout.removeListener('data', logListener);
        process.stderr.removeListener('data', logListener);
        res.end();
    });
});

app.get('/verify-token', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// Listar todas as secretarias
app.get('/secretarias', async (req, res) => {
  try {
    const secretarias = await prisma.secretaria.findMany({ orderBy: { nome: 'asc' } });
    res.json(secretarias);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar a lista de secretarias." });
  }
});


app.get('/requisitos', async (req, res) => {
    try {
        const { secretariaId } = req.query;
        const whereClause = {
            OR: [
                { secretariaId: null },
            ]
        };

        if (secretariaId && secretariaId !== 'undefined') {
            whereClause.OR.push({ secretariaId: parseInt(secretariaId) });
        }

        const requisitos = await prisma.requisito.findMany({
            where: whereClause,
            orderBy: [
                { secretariaId: { sort: 'asc', nulls: 'first' } },
                { id: 'asc' }
            ]
        });
        
        res.json(requisitos);
    } catch (error) {
        console.error("[ERRO CRÍTICO] Falha na rota /requisitos:", error);
        res.status(500).json({ error: "Erro ao buscar a lista de requisitos." });
    }
});

app.delete('/avaliacoes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.resposta.deleteMany({ where: { avaliacaoId: parseInt(id) } });
    await prisma.avaliacao.delete({ where: { id: parseInt(id) } });
    res.json({ success: true, message: 'Avaliação apagada com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao apagar a avaliação.' });
  }
});


app.delete('/sessions/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.link.deleteMany({ where: { session_id: id } });
    await prisma.scanSession.delete({ where: { id: id } });
    res.json({ success: true, message: 'Sessão apagada com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao apagar a sessão.' });
  }
});


app.get("/scan-sessions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const session = await prisma.scanSession.findUnique({ where: { id } });
    if (!session) { return res.status(404).json({ error: "Sessão não encontrada" }); }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar sessão" });
  }
});

app.patch("/scan-session/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { status, total_links, depthReached, errorMessage } = req.body;
    const updateData = {};
    if (status) updateData.status = status;
    if (typeof total_links !== 'undefined') updateData.total_links = total_links;
    if (typeof depthReached !== 'undefined') updateData.depthReached = depthReached;
    if (errorMessage) updateData.errorMessage = errorMessage;
    const updated = await prisma.scanSession.update({ where: { id }, data: updateData });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar scan session' });
  }
});

app.get("/links", async (req, res) => {
  try {
    const { session_id } = req.query;
    console.log(`--- [LOG] Rota GET /links chamada para a session_id: ${session_id}`);

    if (!session_id) {
      console.log("[AVISO] session_id não foi fornecido na requisição.");
      return res.status(400).json({error: "session_id é obrigatório"});
    }

    console.log(`[LOG] Buscando links no banco de dados onde a session_id é exatamente: '${session_id}'`);
    const links = await prisma.link.findMany({
      where: {
        session_id: session_id
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    
    console.log(`[LOG] A consulta do Prisma encontrou ${links.length} links para esta sessão.`);
    res.json(links);

  } catch (error) {
    console.error("[ERRO CRÍTICO] Falha na rota GET /links:", error);
    res.status(500).json({ error: "Erro ao buscar links" });
  }
});

app.patch('/links/by-url', async (req, res) => {
    const { url, session_id } = req.query; 
    const { status, httpCode, finalUrl } = req.body; 
    
    if (!url || !session_id) {
        return res.status(400).json({ error: 'url e session_id são obrigatórios nos parâmetros da URL.' });
    }
    try {
        const dataToUpdate = {};
        if (status) dataToUpdate.status = status;
        if (httpCode != null) dataToUpdate.httpCode = httpCode;
        if (finalUrl != null) dataToUpdate.finalUrl = finalUrl;
        
        const updated = await prisma.link.updateMany({
            where: { url: url, session_id: session_id },
            data: dataToUpdate,
        });
        
        if (updated.count > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, message: 'Nenhum link correspondente encontrado para atualizar.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar o status do link' });
    }
});

app.get('/export/csv/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const links = await prisma.link.findMany({ where: { session_id: sessionId }, orderBy: { url: 'asc' } });
    if (links.length === 0) return res.status(404).send('Nenhum link encontrado.');
    const header = 'URL;Status;Codigo_HTTP;Tipo;Origem;URL_Final\n';
    const rows = links.map(link => {
      const rowData = [link.url, link.status, link.httpCode || '', link.tipo, link.origem, link.finalUrl || ''].map(field => `"${String(field).replace(/"/g, '""')}"`);
      return rowData.join(';');
    }).join('\n');
    const csvContent = header + rows;
    const fileName = `relatorio_${sessionId.substring(0, 8)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.status(200).end(csvContent);
  } catch (error) { res.status(500).send('Erro ao gerar o relatório CSV.'); }
});

app.get('/export/json/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const links = await prisma.link.findMany({ where: { session_id: sessionId }, orderBy: { url: 'asc' } });
    if (links.length === 0) return res.status(404).send('Nenhum link encontrado.');
    const fileName = `relatorio_${sessionId.substring(0, 8)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.json(links);
  } catch (error) { res.status(500).send('Erro ao gerar o relatório JSON.'); }
});

app.get('/export/xlsx/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    const links = await prisma.link.findMany({ where: { session_id: sessionId }, orderBy: { url: 'asc' } });
    if (links.length === 0) return res.status(404).send('Nenhum link encontrado.');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Links');
    worksheet.columns = [
      { header: 'URL', key: 'url', width: 70 }, { header: 'Status', key: 'status', width: 20 },
      { header: 'Codigo HTTP', key: 'httpCode', width: 15 }, { header: 'Tipo', key: 'tipo', width: 15 },
      { header: 'Origem', key: 'origem', width: 70 }, { header: 'URL Final', key: 'finalUrl', width: 70 },
    ];
    worksheet.addRows(links);
    const fileName = `relatorio_${sessionId.substring(0, 8)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) { res.status(500).send('Erro ao gerar o relatório Excel.'); }
});

async function initialCleanup() {
  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const deleted = await prisma.link.deleteMany({ where: { createdAt: { lt: twelveHoursAgo } } });
    if (deleted.count > 0) { console.log(`🧹 Limpeza inicial: ${deleted.count} links antigos removidos.`); }
  } catch (error) { console.error('❌ Erro na limpeza inicial:', error); }
}

// --- FUNÇÃO DE LIMPEZA PARA SESSÕES NÃO ENCERRADAS ---
async function cleanupZombieScans() {
  try {
    const zombieScans = await prisma.scanSession.findMany({
      where: { status: 'iniciado' },
    });

    if (zombieScans.length > 0) {
      console.log(`🧹 Limpando ${zombieScans.length} varredura(s) "zumbi" da última execução...`);
      await prisma.scanSession.updateMany({
        where: { status: 'iniciado' },
        data: { status: 'interrompido' },
      });
      console.log('🧹 Limpeza concluída.');
    }
  } catch (error) {
    console.error('❌ Erro durante a limpeza de varreduras zumbis:', error);
  }
}

// ROTA PARA TESTE - FORÇAR EXPIRAÇÃO DO PRAZO
/*app.post('/api/teste/expirar-recurso/:id', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const prazoExpirado = new Date();
    prazoExpirado.setSeconds(prazoExpirado.getSeconds() - 1);
    
    await prisma.avaliacao.update({
      where: { id: parseInt(id) },
      data: {
        prazoRecurso: prazoExpirado
      },
    });
    
    await expirarRecursos();
    
    res.json({ 
      success: true, 
      message: 'Recurso expirado manualmente para testes',
      avaliacaoId: id
    });
  } catch (error) {
    console.error("Erro no teste de expiração:", error);
    res.status(500).json({ error: 'Erro ao expirar recurso manualmente' });
  }
});

// ROTA GET TEMPORÁRIA PARA RESETAR PRAZO 
app.get('/api/teste/reset-prazo-publico/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    function calcularPrazoTeste(dataInicio) {
      let data = new Date(dataInicio);
      let diasUteis = 0;
      const diasNecessarios = 5;
      
      data.setDate(data.getDate() + 1);
      data.setHours(0, 0, 1, 0);
      
      while (diasUteis < diasNecessarios) {
        data.setDate(data.getDate() + 1);
        const diaSemana = data.getDay();
        if (diaSemana !== 0 && diaSemana !== 6) {
          diasUteis++;
        }
      }
      
      return data;
    }

    const prazoRecurso = calcularPrazoTeste(new Date());

    console.log(`🔄 Resetando prazo via GET para 5 dias úteis: ${prazoRecurso}`);

    const avaliacaoAtualizada = await prisma.avaliacao.update({
      where: { id: parseInt(id) },
      data: {
        prazoRecurso: prazoRecurso,
        recursoExpirado: false,
        status: 'AGUARDANDO_RECURSO'
      },
    });

    const agora = new Date();
    const segundosRestantes = Math.max(0, Math.ceil((prazoRecurso - agora) / 1000));

    res.json({ 
      success: true, 
      message: '✅ Prazo resetado para 5 dias úteis via GET',
      prazoRecurso: prazoRecurso,
      novoPrazoFormatado: prazoRecurso.toLocaleString('pt-BR'),
      segundosRestantes: segundosRestantes,
      detalhes: 'Começa a contar da meia-noite e 1 segundo do próximo dia, excluindo finais de semana'
    });
  } catch (error) {
    console.error("Erro ao resetar prazo via GET:", error);
    res.status(500).json({ error: 'Erro ao resetar prazo.' });
  }
});*/

// --- FUNÇÃO PARA EXPIRAR RECURSOS VENCIDOS ---
async function expirarRecursos() {
  try {
    const agora = new Date();
    
    console.log(`Verificando recursos expirados em: ${agora.toISOString()}`);
    
    const avaliacoesExpiradas = await prisma.avaliacao.findMany({
      where: {
        status: 'AGUARDANDO_RECURSO',
        prazoRecurso: { lt: agora },
        recursoExpirado: false
      },
      include: {
        secretaria: true,
        respostas: {
          include: {
            requisito: true
          }
        }
      }
    });
    
    if (avaliacoesExpiradas.length > 0) {
      console.log(` ${avaliacoesExpiradas.length} recursos expirados encontrados`);
      
      for (const avaliacao of avaliacoesExpiradas) {
        console.log(`⏰ Processando avaliação ${avaliacao.id} - Prazo: ${avaliacao.prazoRecurso}`);
        
        await prisma.avaliacao.update({
          where: { id: avaliacao.id },
          data: {
            recursoExpirado: true,
            status: 'EM_ANALISE_DE_RECURSO'
          }
        });

        console.log(`✅ Avaliação ${avaliacao.id} movida para EM_ANALISE_DE_RECURSO (prazo expirado)`);
        
        await enviarEmailRecursoExpirado(avaliacao);
      }
    } else {
      console.log('Nenhum recurso expirado encontrado');
    }
  } catch (error) {
    console.error('❌ Erro ao expirar recursos:', error);
  }
}

// FUNÇÃO PARA ENVIAR EMAIL DE RECURSO EXPIRADO (NOTA SCGE)
async function enviarEmailRecursoExpirado(avaliacao) {
  try {
    let pontuacaoSCGE = 0;
    let pontuacaoTotal = 0;

    if (avaliacao.respostas && Array.isArray(avaliacao.respostas)) {
      avaliacao.respostas.forEach(resposta => {
        const pontuacaoRequisito = resposta.requisito.pontuacao;
        pontuacaoTotal += pontuacaoRequisito;

        const isSplit = resposta.atendeDisponibilidade !== null || resposta.atendeSerieHistorica !== null;

        if (isSplit) {
          if (resposta.validacaoDisponibilidade === 'aprovado') pontuacaoSCGE += pontuacaoRequisito / 2;
          if (resposta.validacaoSerieHistorica === 'aprovado') pontuacaoSCGE += pontuacaoRequisito / 2;
        } else {
          if (resposta.statusValidacao === 'aprovado') pontuacaoSCGE += pontuacaoRequisito;
        }
      });
    }

    const mailOptions = {
      from: `"Controladoria Geral do Estado - PE" <${process.env.SMTP_USER}>`,
      to: avaliacao.emailResponsavel,
      subject: `Prazo de Recurso Expirado - ${avaliacao.secretaria.sigla}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                .header { background: #002776; color: white; padding: 25px; text-align: center; }
                .content { padding: 25px; background: #f9f9f9; }
                .footer { background: #e9ecef; padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .alerta { background: #fff3cd; border: 2px solid #ffc107; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .nota-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #002776; }
                .badge { display: inline-block; padding: 8px 16px; border-radius: 20px; color: white; font-weight: bold; }
                .nota { background: #002776; }
                .destaque-scge { background: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; margin: 15px 0; }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>Controladoria Geral do Estado</h2>
                <h3>Sistema de Monitoramento da Transparência</h3>
            </div>
            
            <div class="content">
                <h3>Prazo de Recurso Expirado</h3>
                
                <div class="alerta">
                    <p><strong>Informamos que o prazo para envio de recurso expirou.</strong></p>
                </div>
                
                <div class="destaque-scge">
                    <h4>Resultado Final da SCGE</h4>
                    <p>Como não foi enviado recurso, será mantida a validação original da Controladoria-Geral do Estado.</p>
                </div>
                
                <div class="nota-box">
                    <h4>Nota Validada pela SCGE</h4>
                    <p><strong>Órgão/Entidade:</strong> ${avaliacao.secretaria.nome} (${avaliacao.secretaria.sigla})</p>
                    <p><strong>URL Avaliada:</strong> ${avaliacao.urlSecretaria}</p>
                    <p><strong>Nota Final (SCGE):</strong> <span class="badge nota">${pontuacaoSCGE} / ${pontuacaoTotal} pontos</span></p>
                    <p><strong>Data de Expiração:</strong> ${new Date(avaliacao.prazoRecurso).toLocaleDateString('pt-BR')}</p>
                    <p><strong>Status:</strong> EM ANÁLISE FINAL PELA SCGE</p>
                </div>
                
                <p><strong>Próximos Passos:</strong></p>
                <ul>
                    <li>A avaliação voltou para análise final da Controladoria Geral do Estado</li>
                    <li>Será considerada exclusivamente a validação realizada pela SCGE</li>
                    <li>O resultado final será publicado em breve</li>
                    <li>Esta nota reflete a análise técnica da Controladoria-Geral</li>
                </ul>
                
                <p>Atenciosamente,<br>
                <strong>Equipe da Controladoria Geral do Estado de Pernambuco</strong></p>
            </div>
            
            <div class="footer">
                <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                  <p>Controladoria Geral do Estado de Pernambuco<br>
                  R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
            </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email de expiração enviado para: ${avaliacao.emailResponsavel} - Nota SCGE: ${pontuacaoSCGE}/${pontuacaoTotal}`);
    
  } catch (error) {
    console.error(`❌ Erro ao enviar email para ${avaliacao.emailResponsavel}:`, error);
  }
}

// FUNÇÃO PARA ENVIAR EMAIL DE NOTA FINAL PUBLICADA
async function enviarEmailNotaFinal(avaliacao) {
  if (!avaliacao || !avaliacao.emailResponsavel) {
    throw new Error('Dados inválidos para enviar email de nota final.');
  }

  const pontuacaoFinal = avaliacao.pontuacaoFinal || 0;
  const pontuacaoTotal = avaliacao.pontuacaoTotal || 180; 
  const percentual = (pontuacaoFinal / pontuacaoTotal) * 100;
  let mensagemDestaque = '';

  if (percentual === 100) {
    mensagemDestaque = 'EXCELÊNCIA TOTAL!';
  } else if (percentual >= 90 && percentual < 100) {
    mensagemDestaque = 'ÓTIMO DESEMPENHO!';
  } else if (percentual >= 70 && percentual < 90) {
    mensagemDestaque = 'DESEMPENHO SATISFATÓRIO.';
  } else if (percentual > 0 && percentual < 70) {
    mensagemDestaque = 'OPORTUNIDADE DE MELHORIA.';
  } else {
    mensagemDestaque = 'DESEMPENHO CRÍTICO.';
  }

  const mailOptions = {
    from: `"Controladoria Geral do Estado - PE" <${process.env.SMTP_USER}>`,
    to: avaliacao.emailResponsavel,
    subject: `Nota Final Publicada - Avaliação de Transparência - ${avaliacao.secretaria.sigla} - Ciclo 2025`,
    html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    line-height: 1.6; 
                    color: #333; 
                    max-width: 600px; 
                    margin: 0 auto;
                    background: #f5f5f5;
                }
                .email-container {
                    background: white;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .header-img {
                    width: 100%;
                    max-width: 600px;
                    height: auto;
                    display: block;
                    object-fit: contain;
                }
                .content { 
                    padding: 30px; 
                }
                .footer { 
                    background: #e9ecef; 
                    padding: 20px; 
                    text-align: center; 
                    font-size: 12px; 
                    color: #666;
                }
                .resultado-final { 
                    background: #e8f5e8; 
                    border: 1px solid #c3e6cb;
                    border-left: 4px solid #28a745;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                }
                .badge { 
                    display: inline-block; 
                    padding: 8px 16px; 
                    border-radius: 20px; 
                    color: white; 
                    font-weight: bold; 
                    font-size: 1.1em; 
                }
                .aprovado { background: #28a745; }
                .reprovado { background: #dc3545; }
                .btn { 
                    background: #002776; 
                    color: #ffffff !important;  
                    padding: 12px 25px; 
                    text-decoration: none; 
                    border-radius: 6px; 
                    font-weight: bold;
                    display: inline-block;
                    margin: 10px 0;
                }
                .footer-images {
                    display: flex;
                    justify-content: center;
                    gap: 20px;
                    margin: 15px 0;
                    align-items: center;
                }
                .footer-img {
                    max-width: 150px;
                    height: 60px;
                    object-fit: contain;
                }
                .footer-img[alt="SIMPE"] {
                    max-width: 200px;
                    height: 80px;
                }
                h3 { color: #002776; margin-top: 0; }
                h4 { color: #333; margin-top: 0; }
            </style>
        </head>
        <body>
            <div class="email-container">
                <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-footer.png" 
                     alt="Controladoria Geral do Estado" 
                     class="header-img">
                
                <div class="content">
                    <h3>Nota Final Publicada</h3>
                    
                    <p>Prezado(a) ${avaliacao.nomeResponsavel || 'Responsável'},</p>
                    <p>O processo de avaliação da transparência ativa (Ciclo 2025) foi concluído e sua nota final está disponível para consulta.</p>
                    
                    <div class="resultado-final">
                        <h4>Resultado Final da Avaliação</h4>
                        <p style="margin: 8px 0;"><strong>Órgão:</strong> ${avaliacao.secretaria.nome} (${avaliacao.secretaria.sigla})</p>
                        <p style="margin: 8px 0;">
                            <strong>Nota Final:</strong> 
                            <span class="badge ${pontuacaoFinal >= (pontuacaoTotal * 0.7) ? 'aprovado' : 'reprovado'}">
                                ${pontuacaoFinal} / ${pontuacaoTotal}
                            </span>
                        </p>
                        <p style="margin: 8px 0;"><strong>Percentual:</strong> ${percentual.toFixed(1)}%</p>
                        <p style="margin: 8px 0;"><strong>Desempenho:</strong> ${mensagemDestaque}</p>
                    </div>
                    
                    <p>Você pode acessar o relatório detalhado completo, com os comentários da análise final e a evolução da sua pontuação, clicando no botão abaixo:</p>
                    
                    <p style="margin-top: 25px; text-align: center;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/nota-final/${avaliacao.id}" class="btn" style="color: #ffffff !important;">
                            Ver Relatório Final Detalhado
                        </a>
                    </p>
                    
                    <p style="margin-top: 15px;">
                        Atenciosamente,<br>
                        <strong>Equipe da Coordenação de Transparência Ativa (CTA)</strong>
                    </p>
                </div>
                
                <div class="footer">
                    <p><em>Este é um email automático do Sistema de Monitoramento da Transparência.</em></p>
                    <p>Secretaria da Controladoria-Geral do Estado de Pernambuco<br>
                    R. Santo Elias, 535 - Espinheiro, Recife-PE, 52020-090</p>
                    
                    <div class="footer-images">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/SIMPE-marca.png" 
                             alt="SIMPE" 
                             class="footer-img">
                        <img src="${process.env.BASE_URL || 'http://localhost:3000'}/assets/logo-header.png" 
                             alt="Governo de Pernambuco" 
                             class="footer-img">
                    </div>
                </div>
            </div>
        </body>
        </html>
    `
  };

  await transporter.sendMail(mailOptions);
}

// FUNÇÃO AUXILIAR: Recalcular status da resposta pai baseado nos subitens
async function recalcularStatusRespostaPai(respostaId, isPosRecurso = false) {
  try {
    const subRespostas = await prisma.subResposta.findMany({
      where: { respostaId },
      include: { subRequisito: true }
    });
    
    if (subRespostas.length === 0) return;
    
    const campoStatus = isPosRecurso ? 'statusValidacaoPosRecurso' : 'statusValidacao';
    
    const aprovados = subRespostas.filter(s => s[campoStatus] === 'aprovado').length;
    const total = subRespostas.length;
    
    let statusGeral = 'pendente';
    if (aprovados === total) {
      statusGeral = 'aprovado';
    } else if (aprovados === 0) {
      statusGeral = 'rejeitado';
    } else {
      statusGeral = 'parcial'; 
    }
    
    await prisma.resposta.update({
      where: { id: respostaId },
      data: {
        [isPosRecurso ? 'statusValidacaoPosRecurso' : 'statusValidacao']: statusGeral
      }
    });
    
    console.log(`📊 Resposta ${respostaId} recalculada: ${aprovados}/${total} aprovados → status: ${statusGeral}`);
    
  } catch (error) {
    console.error('❌ Erro ao recalcular status da resposta pai:', error);
  }
}

app.post('/api/requisitos-extras', authenticateToken, authenticateAdmin, async (req, res) => {
    const { texto, pontuacao, secretariaId, textoAjuda } = req.body;

    if (!texto || !pontuacao || !secretariaId) {
        return res.status(400).json({ error: 'Texto, pontuação e ID da secretaria são obrigatórios.' });
    }

    try {
        const novoRequisito = await prisma.requisito.create({
            data: {
                texto: texto,
                pontuacao: parseInt(pontuacao),
                secretariaId: parseInt(secretariaId),
                textoAjuda: textoAjuda && textoAjuda.trim() !== "" ? textoAjuda : "Instrução específica da administração."
            }
        });
        res.json(novoRequisito);
    } catch (error) {
        res.status(500).json({ error: "Erro ao criar o requisito extra." });
    }
});

// 2. Listar apenas os requisitos extras de uma secretaria
app.get('/api/secretarias/:id/requisitos-extras', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const extras = await prisma.requisito.findMany({
            where: { 
                secretariaId: parseInt(id) 
            },
            orderBy: { id: 'asc' }
        });
        res.json(extras);
    } catch (error) {
        console.error('Erro ao buscar requisitos extras:', error);
        res.status(500).json({ error: "Erro ao buscar requisitos extras." });
    }
});

app.delete('/api/requisitos/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { force } = req.query; 
    const requisitoId = parseInt(id);

    try {
        const requisito = await prisma.requisito.findUnique({ where: { id: requisitoId } });
        
        if (!requisito) {
            return res.status(404).json({ error: "Requisito não encontrado." });
        }

        // Permite exclusão de globais apenas com force=true
        if (requisito.secretariaId === null && force !== 'true') {
            return res.status(403).json({ 
                error: "Não é permitido excluir requisitos globais.",
                suggestion: "Use ?force=true para forçar a exclusão"
            });
        }

        await prisma.$transaction([
            prisma.evidencia.deleteMany({
                where: { resposta: { requisitoId: requisitoId } }
            }),
            prisma.linkAnalista.deleteMany({
                where: { resposta: { requisitoId: requisitoId } }
            }),
            prisma.linkAnaliseFinal.deleteMany({
                where: { resposta: { requisitoId: requisitoId } }
            }),
            prisma.resposta.deleteMany({
                where: { requisitoId: requisitoId }
            }),
            prisma.requisito.delete({ 
                where: { id: requisitoId } 
            })
        ]);
        
        console.log(`[ADMIN] Requisito ${id} e suas dependências foram excluídos.`);
        res.json({ success: true, message: "Requisito excluído com sucesso." });

    } catch (error) {
        console.error('Erro ao excluir requisito:', error);
        res.status(500).json({ error: "Erro ao excluir requisito.", details: error.message });
    }
});

app.delete('/api/avaliacoes/:id', authenticateToken, authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.$transaction([
            prisma.evidencia.deleteMany({ where: { resposta: { avaliacaoId: parseInt(id) } } }),
            prisma.linkAnalista.deleteMany({ where: { resposta: { avaliacaoId: parseInt(id) } } }),
            prisma.linkAnaliseFinal.deleteMany({ where: { resposta: { avaliacaoId: parseInt(id) } } }),
            prisma.resposta.deleteMany({ where: { avaliacaoId: parseInt(id) } }),
            prisma.avaliacao.delete({ where: { id: parseInt(id) } })
        ]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Erro ao excluir avaliação completa." });
    }
});

app.listen(PORT, '0.0.0.0', async () => { 
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    await cleanupZombieScans();
    await expirarRecursos();
    // initialCleanup(); 
});