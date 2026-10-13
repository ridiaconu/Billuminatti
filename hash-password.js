// Utilizare: node hash-password.js "parola-ta"  ->  valoare pentru AUTH_PASSWORD_HASH
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw) { console.error('Utilizare: node hash-password.js "parola"'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
console.log(`scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`);
