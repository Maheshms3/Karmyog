const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(filePath, 'utf-8');

const envs = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MEASUREMENT_ID'
];

envs.forEach(env => {
  const placeholder = `%%${env}%%`;
  const value = process.env[env] || '';
  html = html.replace(new RegExp(placeholder, 'g'), value);
});

fs.writeFileSync(filePath, html, 'utf-8');
