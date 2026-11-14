export type Box = { iv: string; ciphertext: string };
export type Vault = {
  id: string;
  user_id: string;
  version: number;
  salt: string;
  iterations: number;
  wrapped: Box;
  recovery: Box;
};
export type Row = {
  id: string;
  user_id: string;
  version: number;
  iv: string;
  ciphertext: string;
  updated_at?: string;
};
export type Credential = {
  id: string;
  name: string;
  category: string;
  website: string;
  url: string;
  username: string;
  password: string;
  email: string;
  phone: string;
  question: string;
  answer: string;
  notes: string;
  tags: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  usedAt: string;
};
export type Category = { id: string; name: string };
export type Mutation = {
  table: "credentials" | "categories";
  id: string;
  expected: number;
  row: Row | null;
};
export const defaults = [
  "网站账号",
  "社交账号",
  "邮箱账号",
  "银行及金融",
  "软件及工具",
  "游戏账号",
];
export const emptyCredential = (): Credential => ({
  id: crypto.randomUUID(),
  name: "",
  category: "网站账号",
  website: "",
  url: "",
  username: "",
  password: "",
  email: "",
  phone: "",
  question: "",
  answer: "",
  notes: "",
  tags: "",
  favorite: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  usedAt: "",
});
