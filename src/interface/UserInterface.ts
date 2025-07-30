// src/interfaces/UserInterface.ts

export interface User {
    id: number;
    email: string;
    password_hash: string;
    username: string;
    plan_id: number;
    created_at: Date;
    last_login_at: Date | null;
  }
  
  export interface NewUserRegistration {
    email: string;
    password: string;
  }