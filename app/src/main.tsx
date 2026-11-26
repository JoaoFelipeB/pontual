import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { setupNative } from './lib/native';

setupNative();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
