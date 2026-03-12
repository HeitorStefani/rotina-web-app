const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'rotina-secret-change-in-production';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
