import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD8LknM4-htzyEVyekB7lIX_aUnVVqkNWc",
  authDomain: "commanding-armor-5s6r9.firebaseapp.com",
  projectId: "commanding-armor-5s6r9",
  storageBucket: "commanding-armor-5s6r9.firebasestorage.app",
  messagingSenderId: "975655381036",
  appId: "1:975655381036:web:acc0ae3e3289a7d1a6c989"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore with the custom databaseId from configuration
export const db = getFirestore(app, "ai-studio-f20ce22f-f00c-4249-a048-9024fbf92dc6");
