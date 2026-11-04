require("dotenv").config();
const { Bot, Keyboard, InlineKeyboard, InputFile } = require("grammy");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const axios = require("axios");

const RUPEE = String.fromCharCode(8377);
const configCache = { data: {}, loaded: false, lastLoad: 0 };
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use("/miniapp", express.static(path.join(__dirname, "public")));

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const MAIN_OWNER_ID = parseInt(process.env.ADMIN_ID || "8061612320", 10);

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN & MONGO_URI required!");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const userState = {};
const CURRENT_LAYOUT_VERSION = "v3.0.0";

function toSmallCaps(text) {
  const map = {
    'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ',
    'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
    's': 'ꜱ', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
  };
  return String(text).split('').map(c => map[c.toLowerCase()] || c).join('');
}

function toCapitalSmallCaps(text) {
  let str = String(text);
  let isFirst = true;
  return str.split('').map(c => {
    if (/[a-zA-Z]/.test(c)) {
      if (isFirst) { isFirst = false; return c.toUpperCase(); }
      return toSmallCaps(c);
    }
    return c;
  }).join('');
}

function applyFont(text, fontType = "normal") {
  if (!text) return text;
  switch (fontType) {
    case "smallcaps": return toSmallCaps(text);
    case "capital_smallcaps": return toCapitalSmallCaps(text);
    case "bold": return `<b>${text}</b>`;
    case "italic": return `<i>${text}</i>`;
    case "bold_italic": return `<b><i>${text}</i></b>`;
    case "monospace": return `<code>${text}</code>`;
    case "underline": return `<u>${text}</u>`;
    case "strike": return `<s>${text}</s>`;
    case "spoiler": return `<tg-spoiler>${text}</tg-spoiler>`;
    case "normal":
    default: return text;
  }
}

function entitiesToHtml(text, entities) {
  if (!entities || entities.length === 0) return String(text || "");
  let sorted = [...entities].sort((a, b) => b.offset - a.offset);
  let result = String(text);
  for (let ent of sorted) {
    let before = result.substring(0, ent.offset);
    let target = result.substring(ent.offset, ent.offset + ent.length);
    let after = result.substring(ent.offset + ent.length);
    let wrapped = target;
    switch (ent.type) {
      case "bold": wrapped = `<b>${target}</b>`; break;
      case "italic": wrapped = `<i>${target}</i>`; break;
      case "underline": wrapped = `<u>${target}</u>`; break;
      case "strikethrough": wrapped = `<s>${target}</s>`; break;
      case "spoiler": wrapped = `<tg-spoiler>${target}</tg-spoiler>`; break;
      case "code": wrapped = `<code>${target}</code>`; break;
      case "pre": wrapped = `<pre>${target}</pre>`; break;
      case "text_link": wrapped = `<a href="${ent.url}">${target}</a>`; break;
      case "blockquote": wrapped = `<blockquote>${target}</blockquote>`; break;
      case "text_mention":
        if (ent.user) wrapped = `<a href="tg://user?id=${ent.user.id}">${target}</a>`;
        break;
      case "custom_emoji":
        wrapped = `<tg-emoji emoji-id="${ent.custom_emoji_id}">${target}</tg-emoji>`;
        break;
      default: wrapped = target;
    }
    result = before + wrapped + after;
  }
  return result;
}

function formatDateTime(date) {
  const d = new Date(date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  let hours = ist.getHours();
  let ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${String(ist.getDate()).padStart(2,'0')} ${months[ist.getMonth()]} ${ist.getFullYear()}, ${String(hours).padStart(2,'0')}:${String(ist.getMinutes()).padStart(2,'0')}:${String(ist.getSeconds()).padStart(2,'0')} ${ampm}`;
}

function halfMaskUPI(upi) {
  if (!upi || upi === "Not Set") return upi;
  let str = String(upi).trim();
  let parts = str.split('@');
  if (parts.length !== 2) {
    if (str.length <= 4) return str.substring(0, 1) + '***';
    return str.substring(0, 3) + '***' + str.substring(str.length - 2);
  }
  let name = parts[0];
  let domain = parts[1];
  let maskedName = name.length <= 3 ? name.substring(0, 1) + '***' : name.substring(0, 3) + '***';
  return `${maskedName}@${domain}`;
}

function halfMaskBank(accNo) {
  if (!accNo || accNo === "Not Set") return accNo;
  let str = String(accNo).trim();
  if (str.length <= 6) return str.substring(0, 2) + '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}

function halfMaskWallet(wallet) {
  if (!wallet || wallet === "Not Set") return wallet;
  let str = String(wallet).trim();
  if (str.length <= 6) return str.substring(0, 2) + '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}

function halfMaskDetails(method, details) {
  if (method === "UPI" || method === "AUTO_UPI" || method === "AUTO_BANK") return halfMaskUPI(details);
  if (method === "BANK" || method === "Bank") {
    let parts = String(details).split(',').map(s => s.trim());
    let maskedAcc = halfMaskBank(parts[0]);
    return maskedAcc + (parts[1] ? ` (${parts[1]})` : '');
  }
  if (method === "WALLET" || method === "Wallet") return halfMaskWallet(details);
  if (method === "AMAZON" || method === "Amazon") return halfMaskUPI(details);
  return halfMaskUPI(details);
}

function generateTxnNumber() {
  let num = '';
  for (let i = 0; i < 20; i++) num += Math.floor(Math.random() * 10);
  return num;
}

function generatePaymentRef() {
  return "PAY" + Date.now() + Math.floor(Math.random() * 1000);
}

function convertOwnerLink(input) {
  let str = String(input || "").trim();
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('tg://')) return str;
  if (str.startsWith('@')) return `https://t.me/${str.substring(1)}`;
  if (/^\d+$/.test(str)) return `tg://user?id=${str}`;
  return `https://t.me/${str}`;
}

function isValidTelegramID(input) {
  let str = String(input || "").trim();
  if (!str) return false;
  if (str.startsWith("https://t.me/")) return true;
  if (str.startsWith("tg://user?id=")) return true;
  if (/^\d+$/.test(str)) return true;
  let cleanUsername = str.replace(/^@/, '');
  if (/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) return true;
  return false;
}

function formatBalance(balance) {
  let num = Number(balance) || 0;
  if (num < 0) return `-${RUPEE}${Math.abs(num).toFixed(2)}`;
  return `${RUPEE}${num.toFixed(2)}`;
}

function makeProgressBar(percent) {
  let total = 20;
  let filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * total);
  return `[${"█".repeat(filled)}${"░".repeat(total - filled)}]`;
}

function formatTimeAgo(date) {
  let diff = Date.now() - new Date(date).getTime();
  let min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  let hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function calculateFixedTax(amount, slabs) {
  if (!slabs || !Array.isArray(slabs) || slabs.length === 0) return 0;
  var amt = Number(amount);
  for (var i = 0; i < slabs.length; i++) {
    var s = slabs[i];
    var min = Number(s.min);
    var max = Number(s.max);
    var tax = Number(s.tax);
    if (amt >= min && amt <= max) return tax;
  }
  return 0;
}

function parseTaxSlabInput(input) {
  var str = String(input || "").trim();
  var parts = str.split(/\s+/).filter(function(p) { return p !== ""; });
  if (parts.length !== 3) return null;
  var min = parseFloat(parts[0]);
  var max = parseFloat(parts[1]);
  var tax = parseFloat(parts[2]);
  if (isNaN(min) || isNaN(max) || isNaN(tax)) return null;
  if (min < 0 || max < 0 || tax < 0) return null;
  if (min >= max) return null;
  return { min: min, max: max, tax: tax };
}

function removeUPIFieldsFromResponse(responseData) {
  try {
    var data = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
    if (!data || typeof data !== 'object') return responseData;
    var upiFields = ['upi', 'upi_id', 'vpa', 'address', 'payee', 'payee_upi', 'payee_vpa', 'account', 'wallet', 'phone', 'mobile'];
    function cleanObj(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(cleanObj);
      var cleaned = {};
      for (var key in obj) {
        if (upiFields.indexOf(key.toLowerCase()) >= 0) continue;
        cleaned[key] = cleanObj(obj[key]);
      }
      return cleaned;
    }
    return JSON.stringify(cleanObj(data));
  } catch (e) {
    return String(responseData);
  }
}

function parseInlineButtons(input) {
  if (!input || !input.trim()) return null;
  var lines = input.trim().split("\n").filter(function(l) { return l.trim() !== ""; });
  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].trim().split("&&").map(function(p) { return p.trim(); }).filter(function(p) { return p !== ""; });
    var rowButtons = [];
    for (var j = 0; j < parts.length; j++) {
      var match = parts[j].match(/^(.+?)\s*-\s*(https?:\/\/\S+)\s*$/);
      if (match) rowButtons.push({ text: match[1].trim(), url: match[2].trim() });
    }
    if (rowButtons.length > 0) rows.push(rowButtons);
  }
  return rows.length > 0 ? rows : null;
}

function buildInlineKeyboardFromRows(rows) {
  if (!rows || rows.length === 0) return null;
  var inline_keyboard = [];
  for (var i = 0; i < rows.length; i++) {
    var btnRow = [];
    for (var j = 0; j < rows[i].length; j++) {
      btnRow.push({ text: rows[i][j].text, url: rows[i][j].url });
    }
    inline_keyboard.push(btnRow);
  }
  return { inline_keyboard: inline_keyboard };
}

function formatMinutes(min) {
  if (min < 60) return `${min} minutes`;
  if (min < 1440) return `${min / 60} hour(s)`;
  return `${min / 1440} day(s)`;
}

function buildProcessingDots(frame) {
  const dots = ["●  ○  ○", "●  ●  ○", "●  ●  ●", "○  ●  ●", "○  ○  ●"];
  return dots[frame % dots.length];
}

function validateUPI(upi) {
  if (!upi) return false;
  let upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$/;
  return upiRegex.test(String(upi).trim());
}

function validateWallet(wallet) {
  if (!wallet) return false;
  return /^\d{10,12}$/.test(String(wallet).trim());
}

function validateBankAcc(accNo) {
  if (!accNo) return false;
  return /^\d{9,18}$/.test(String(accNo).trim());
}

function validateIFSC(ifsc) {
  if (!ifsc) return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(ifsc).trim().toUpperCase());
}

function buildSuccessMessage(amount, masked, txnNumber, processTime, methodName) {
  return "\uD83C\uDF81 Your Withdrawal of Rs.<code>" + amount.toFixed(2) + "</code> is Successfully Processed!\uD83D\uDD25\uD83D\uDD25\n\n" +
    "\uD83C\uDFE6 Destination ==> <code>" + masked + "</code>\n" +
    "\uD83D\uDE80 Transaction ID ==> <code>" + txnNumber + "</code>\n" +
    "\uD83D\uDDD3\uFE0F Date and time ==> " + formatDateTime(processTime) + "\n\n" +
    "\u2705 Please Check Your " + methodName + " Account!";
}

function buildManualPendingMessage(amount, methodLabel, maskedDetails, userWithdrawalCount, taxAmount, netAmount, newBalance) {
  var taxLine;
  if (taxAmount > 0) {
    taxLine = "\uD83D\uDCC9 Tax: " + RUPEE + taxAmount.toFixed(2) + " | \u2705 Receive: " + RUPEE + netAmount.toFixed(2);
  } else {
    taxLine = "\u2705 Receive: " + RUPEE + amount.toFixed(2) + " (no tax)";
  }
  var methodIcon = methodLabel === "UPI" ? "\u26A1" : "\uD83C\uDF81";
  return "\u2705 REQUEST SUBMITTED\n\n" +
    "\uD83D\uDCB8 " + RUPEE + amount.toFixed(2) + " \u2192 " + methodLabel + "\n" +
    methodIcon + " " + maskedDetails + "\n" +
    "\uD83C\uDD94 #" + userWithdrawalCount + "\n\n" +
    taxLine + "\n" +
    "\uD83D\uDCB5 New Balance: " + RUPEE + newBalance.toFixed(2) + "\n\n" +
    "\u23F3 Pending admin approval...";
}

function buildPayoutChannelMessage(methodLabel, userWithdrawalCount, userId, amount, netAmount, maskedDetails, paymentRef, statusText) {
  var methodIcon = methodLabel === "UPI" ? "\u26A1" : "\uD83C\uDF81";
  var userLink = '<a href="tg://user?id=' + userId + '"><b>' + userId + '</b></a>';
  return "\u26A0\uFE0F New " + methodLabel + " Payout Request! (#" + userWithdrawalCount + ")\n\n" +
    "User : " + userLink + "\n" +
    "Request Amount : " + RUPEE + amount + "\n" +
    "Amount After Tax : " + RUPEE + netAmount.toFixed(2) + "\n" +
    "UPI ID : " + maskedDetails + "\n" +
    "Payment Ref : " + paymentRef + "\n\n" +
    "Manual UPI Response : " + statusText;
}

function buildWithdrawalConfirmMessage(amount, payoutAmount, taxAmount, walletOrUpi) {
  var bodyText = "Amount: <code>" + amount + "</code> INR\n" +
    "You receive: <code>" + payoutAmount.toFixed(2) + "</code> INR (Tax: <code>" + RUPEE + taxAmount.toFixed(2) + "</code>)\n\n" +
    "Wallet: <code>" + walletOrUpi + "</code>";
  return "<b>Withdrawal Confirmation</b>\n\n<blockquote>" + bodyText + "</blockquote>\n\nConfirm your transaction by clicking Confirm";
}

const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  username: { type: String, default: "" },
  balance: { type: Number, default: 0 },
  walletId: { type: String, default: "" },
  walletAccount: { type: String, default: "Not Set" },
  upiId: { type: String, default: "Not Set" },
  bankAccNo: { type: String, default: "Not Set" },
  bankIfsc: { type: String, default: "Not Set" },
  amazonEmail: { type: String, default: "Not Set" },
  redeemCodeAddr: { type: String, default: "Not Set" },
  gatewayNumbers: { type: Map, of: String, default: {} },
  walletNumber: { type: String, default: "" },
  depositApiUrl: { type: String, default: "" },
  joinedChannels: { type: [String], default: [] },
  withdrawnTotal: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

const userPreferenceSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  keyboardLayout: { type: Array, default: null },
  inlineMenus: { type: Object, default: {} },
  adminPanelLayout: { type: Array, default: null },
  fontPreference: { type: String, default: "normal" },
  updatedAt: { type: Date, default: Date.now }
});
const UserPreference = mongoose.models.UserPreference || mongoose.model("UserPreference", userPreferenceSchema);

const botAdminSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
  disabledAt: { type: Date, default: null },
  disabledBy: { type: Number, default: null }
});
const BotAdmin = mongoose.models.BotAdmin || mongoose.model("BotAdmin", botAdminSchema);

const taskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  title: { type: String, default: "" },
  reward: { type: Number, default: 0 },
  link: { type: String, default: "" },
  description: { type: String, default: "" },
  taskType: { type: String, default: "photo" },
  alertChannel: { type: String, default: "Not Set" },
  completedUsers: { type: [Number], default: [] },
  isActive: { type: Boolean, default: true },
  isComplete: { type: Boolean, default: false },
  expiryMinutes: { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Task = mongoose.models.Task || mongoose.model("Task", taskSchema);

const giftCodeSchema = new mongoose.Schema({
  code: { type: String, required: true },
  amount: { type: Number, required: true },
  type: { type: String, default: "redeem" },
  maxUses: { type: Number, default: 1 },
  usedUsers: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});
giftCodeSchema.index({ code: 1, type: 1 }, { unique: true });
const GiftCode = mongoose.models.GiftCode || mongoose.model("GiftCode", giftCodeSchema);

const taskSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  userName: { type: String, default: "" },
  taskId: { type: String, required: true },
  taskTitle: { type: String, required: true },
  reward: { type: Number, required: true },
  photoFileId: { type: String, required: true },
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});
const TaskSubmission = mongoose.models.TaskSubmission || mongoose.model("TaskSubmission", taskSubmissionSchema);

const withdrawalSchema = new mongoose.Schema({
  withdrawalId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  userWithdrawalCount: { type: Number, default: 1 },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, required: true },
  details: { type: String, required: true },
  status: { type: String, default: "Pending" },
  isGateway: { type: Boolean, default: false },
  gatewayName: { type: String, default: "" },
  gatewayResponse: { type: String, default: "" },
  txnNumber: { type: String, default: "" },
  paymentRef: { type: String, default: "" },
  taxPercent: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  oldBalance: { type: Number, default: 0 },
  newBalance: { type: Number, default: 0 },
  userMessageId: { type: Number, default: null },
  userChatId: { type: Number, default: null },
  approvedBy: { type: String, default: "" },
  approvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);

const balanceHistorySchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  action: { type: String, required: true },
  amount: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const BalanceHistory = mongoose.models.BalanceHistory || mongoose.model("BalanceHistory", balanceHistorySchema);

const adminLogSchema = new mongoose.Schema({
  adminId: { type: Number, required: true },
  adminName: { type: String, default: "" },
  action: { type: String, required: true },
  details: { type: String, default: "" },
  amount: { type: Number, default: 0 },
  targetUserId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const AdminLog = mongoose.models.AdminLog || mongoose.model("AdminLog", adminLogSchema);

const upiPaymentSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  userId: { type: Number, required: true },
  amount: { type: Number, required: true },
  utr: { type: String, default: "" },
  upiId: { type: String, required: true },
  status: { type: String, default: "Pending" },
  source: { type: String, default: "bot" },
  verifiedAt: { type: Date, default: null },
  approvedBy: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const UPIPayment = mongoose.models.UPIPayment || mongoose.model("UPIPayment", upiPaymentSchema);

const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  inviteLink: { type: String, required: true },
  displayName: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  isHidden: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now }
});
const Channel = mongoose.models.Channel || mongoose.model("Channel", channelSchema);

const socialLinkSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
const SocialLink = mongoose.models.SocialLink || mongoose.model("SocialLink", socialLinkSchema);

const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
});
const Config = mongoose.models.Config || mongoose.model("Config", configSchema);

const gatewaySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  url_template: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
  createdBy: { type: Number, default: null },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});
const Gateway = mongoose.models.Gateway || mongoose.model("Gateway", gatewaySchema);

const autoUpiSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  apiKey: { type: String, default: "" },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
  order: { type: Number, default: 0 },
  createdBy: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now }
});
const AutoUpi = mongoose.models.AutoUpi || mongoose.model("AutoUpi", autoUpiSchema);

const autoBankSchema = new mongoose.Schema({
  gatewayId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  apiUrl: { type: String, required: true },
  method: { type: String, default: "GET" },
  status: { type: String, default: "active" },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
  payoutChannel: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const AutoBank = mongoose.models.AutoBank || mongoose.model("AutoBank", autoBankSchema);

const withdrawSettingsSchema = new mongoose.Schema({
  method: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  minAmount: { type: Number, default: 0 },
  maxAmount: { type: Number, default: 0 },
  taxPercent: { type: Number, default: 0 },
  taxSlabs: { type: Array, default: [] },
  updatedAt: { type: Date, default: Date.now }
});
const WithdrawSettings = mongoose.models.WithdrawSettings || mongoose.model("WithdrawSettings", withdrawSettingsSchema);

const liveFundSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: "main_fund" },
  totalFund: { type: Number, default: 0 },
  usedFund: { type: Number, default: 0 },
  isActive: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});
const LiveFund = mongoose.models.LiveFund || mongoose.model("LiveFund", liveFundSchema);

const broadcastSchema = new mongoose.Schema({
  broadcastId: { type: String, required: true, unique: true },
  adminId: { type: Number, required: true },
  adminName: { type: String, default: "" },
  messageType: { type: String, default: "text" },
  content: { type: String, default: "" },
  fileId: { type: String, default: "" },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  timeTaken: { type: Number, default: 0 },
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});
const Broadcast = mongoose.models.Broadcast || mongoose.model("Broadcast", broadcastSchema);

const newUserLogSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  firstName: { type: String, default: "" },
  username: { type: String, default: "" },
  startTime: { type: Date, default: Date.now }
});
const NewUserLog = mongoose.models.NewUserLog || mongoose.model("NewUserLog", newUserLogSchema);

const DEFAULT_KEYBOARD_LAYOUT = [
  { name: `📋 ${toSmallCaps("Bot Task")}`, key: "btn_tasks", row: 0, hidden: false, style: "" },
  { name: `💸 ${toSmallCaps("My Balance")}`, key: "btn_balance", row: 0, hidden: false, style: "" },
  { name: `🎁 ${toSmallCaps("Gift Code")}`, key: "btn_gift", row: 1, hidden: false, style: "" },
  { name: `⚡ ${toSmallCaps("Quick Pay")}`, key: "btn_quickpay", row: 1, hidden: false, style: "" },
  { name: `💳 ${toSmallCaps("Payout Method")}`, key: "btn_payout", row: 2, hidden: false, style: "" },
  { name: `🚀 ${toSmallCaps("Withdraw")}`, key: "btn_withdraw", row: 2, hidden: false, style: "" }
];

const DEFAULT_ADMIN_PANEL_LAYOUT = [
  { name: `👮 Add/Remove Admins Permission`, key: "adm_permissions", row: 0, hidden: false, style: "" },
  { name: `👑 Transfer Ownership`, key: "adm_transfer", row: 1, hidden: false, style: "" },
  { name: `💰 Set Tax Slabs`, key: "adm_tax_menu", row: 1, hidden: false, style: "" },
  { name: `👮 Manage Admins`, key: "adm_admins", row: 2, hidden: false, style: "" },
  { name: `🚫 Manage Ban Users`, key: "adm_manage_ban", row: 2, hidden: false, style: "" },
  { name: `🤖 Bot Status`, key: "adm_bot_status", row: 3, hidden: false, style: "" },
  { name: `🚫 Manage Ban Wallet`, key: "adm_manage_ban_wallet", row: 3, hidden: false, style: "" },
  { name: `💸 Withdraw Status`, key: "adm_wd_status", row: 4, hidden: false, style: "" },
  { name: `➕ Add Balance`, key: "adm_add_bal", row: 4, hidden: false, style: "" },
  { name: `➖ Remove Balance`, key: "adm_rem_bal", row: 5, hidden: false, style: "" },
  { name: `⚡ Manage Your Channels`, key: "adm_manage_channels", row: 5, hidden: false, style: "" },
  { name: `⚠️ Reset Balance`, key: "adm_reset_all_bal", row: 6, hidden: false, style: "" },
  { name: `🎨 Customize Your Theme`, key: "adm_customize_theme", row: 6, hidden: false, style: "" },
  { name: `💬 Talk With User`, key: "adm_talk_user", row: 7, hidden: false, style: "" },
  { name: `📢 Broadcast`, key: "adm_broadcast", row: 7, hidden: false, style: "" },
  { name: `🔍 Find User Details`, key: "adm_find_user", row: 8, hidden: false, style: "" },
  { name: `📊 Status`, key: "adm_status", row: 8, hidden: false, style: "" },
  { name: `⚡ Quick Pay`, key: "adm_quick_pay", row: 9, hidden: false, style: "" },
  { name: `🚀 Withdrawal Step`, key: "adm_gateway_menu", row: 9, hidden: false, style: "" },
  { name: `🎁 Gift Codes`, key: "adm_create_gift", row: 10, hidden: false, style: "" },
  { name: `🔔 New User Notification`, key: "adm_user_notif", row: 11, hidden: false, style: "" },
  { name: `🎁 Manage Redeem Codes`, key: "adm_redeem", row: 11, hidden: false, style: "" },
  { name: `📧 Manage Amazon Codes`, key: "adm_amazon", row: 12, hidden: false, style: "" },
  { name: `📋 Manage Tasks`, key: "adm_tasks_manager", row: 12, hidden: false, style: "" },
  { name: `📢 User Update`, key: "adm_user_update", row: 13, hidden: false, style: "" },
  { name: `🚀 Recent Admin Actions`, key: "adm_recent_actions", row: 13, hidden: false, style: "" },
  { name: `🔄 Refresh Panel`, key: "admin", row: 14, hidden: false, style: "" }
];

const DEFAULT_BALANCE_TEXT = {
  welcome: `⭐ ${toSmallCaps("Welcome To Bot!")}`,
  footer: `❝ ${toSmallCaps("Built with security you can Trust.")}\n${toSmallCaps("Support that responds promptly")} ❞`
};

const DEFAULT_START_TEXT = {
  title: `💫 ${toSmallCaps("Welcome To Task Payment Bot!")}`,
  linkPrefix: `${toSmallCaps("How To Earn")} → `,
  linkClickable: `${toSmallCaps("Click Here")}`
};

const FONT_OPTIONS = [
  { key: "normal", name: "Normal", preview: "Admin Panel" },
  { key: "smallcaps", name: "Small Caps", preview: "ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ" },
  { key: "capital_smallcaps", name: "Capital Small Caps", preview: "Aᴅᴍɪɴ Pᴀɴᴇʟ" },
  { key: "bold", name: "Bold", preview: "Admin Panel" },
  { key: "italic", name: "Italic", preview: "Admin Panel" },
  { key: "bold_italic", name: "Bold Italic", preview: "Admin Panel" },
  { key: "monospace", name: "Monospace", preview: "Admin Panel" },
  { key: "underline", name: "Underline", preview: "Admin Panel" },
  { key: "strike", name: "Strike", preview: "Admin Panel" },
  { key: "spoiler", name: "Spoiler", preview: "Admin Panel" }
];

async function preloadAllConfigs() {
  try {
    let allConfigs = await Config.find({}).lean();
    let newData = {};
    for (let conf of allConfigs) {
      newData[conf.key] = conf.value;
    }
    configCache.data = newData;
    configCache.loaded = true;
    configCache.lastLoad = Date.now();
    console.log(`Configs preloaded: ${allConfigs.length} keys`);
  } catch (e) {
    console.error("Config preload error:", e.message);
  }
}

async function getConfig(key, defaultValue) {
  if (configCache.data[key] !== undefined) {
    return configCache.data[key];
  }
  let conf = await Config.findOne({ key }).lean();
  let value = conf ? conf.value : defaultValue;
  configCache.data[key] = value;
  return value;
}

async function setConfig(key, value) {
  configCache.data[key] = value;
  await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function isAdmin(userId) {
  try {
    if (Number(userId) === Number(MAIN_OWNER_ID)) return true;
    let ownerId = configCache.data["owner_id"] ?? await getConfig("owner_id", MAIN_OWNER_ID);
    if (Number(userId) === Number(ownerId)) return true;
    let botAdmin = await BotAdmin.findOne({ userId, isActive: true }).lean();
    if (botAdmin) return true;
    return false;
  } catch (e) { return false; }
}

async function isAdminDisabled(userId) {
  try {
    let botAdmin = await BotAdmin.findOne({ userId, isActive: false }).lean();
    return !!botAdmin;
  } catch (e) { return false; }
}

async function isOwner(userId) {
  let ownerId = configCache.data["owner_id"] ?? await getConfig("owner_id", MAIN_OWNER_ID);
  return Number(userId) === Number(ownerId) || Number(userId) === Number(MAIN_OWNER_ID);
}

async function isWhitelisted(userId) {
  try {
    let whitelist = await getConfig("quick_pay_whitelist", []);
    if (!Array.isArray(whitelist)) return false;
    return whitelist.map(Number).includes(Number(userId));
  } catch (e) { return false; }
}

async function getUser(userId) {
  return await User.findOneAndUpdate(
    { userId },
    { $setOnInsert: { walletId: userId.toString() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function checkForceJoin(ctx) {
  let forceJoinEnabled = await getConfig("force_join_enabled", true);
  if (!forceJoinEnabled) return true;
  let userId = ctx.from.id;
  let isOwnerUser = await isOwner(userId);
  let isAdminUser = await isAdmin(userId);
  if (isOwnerUser || isAdminUser) return true;
  let channels = await Channel.find({ isActive: true, isHidden: { $ne: true } }).lean();
  if (!channels || channels.length === 0) return true;
  let bannedAllowed = await getConfig("banned_in_channel_allowed", true);
  let joinedChannels = [];
  let results = await Promise.allSettled(
    channels.map(ch =>
      ctx.api.getChatMember(ch.channelId, userId)
        .then(m => ({ ch, status: m.status }))
        .catch(() => ({ ch, status: "error" }))
    )
  );
  for (let r of results) {
    if (r.status !== "fulfilled") continue;
    let { ch, status } = r.value;
    if (status === "kicked") {
      if (bannedAllowed) continue;
      return false;
    }
    if (["left", "restricted"].includes(status)) {
      return false;
    }
    if (["member", "administrator", "creator"].includes(status)) {
      joinedChannels.push(ch.channelId);
    }
  }
  if (joinedChannels.length > 0) {
    await User.updateOne({ userId }, { joinedChannels });
  }
  return true;
}

async function getPayoutChannel(method = null) {
  let newCh = await getConfig("payout_channel", null);
  if (newCh && newCh !== "Not Set") return newCh;
  if (method) {
    let oldCh = await getConfig("payout_channel_" + method.toLowerCase(), null);
    if (oldCh && oldCh !== "Not Set") return oldCh;
  }
  for (let m of ["upi", "bank", "wallet", "amazon", "redeem"]) {
    let oldCh = await getConfig("payout_channel_" + m, null);
    if (oldCh && oldCh !== "Not Set") return oldCh;
  }
  return "Not Set";
}

async function getMethodPayoutChannel(method, methodObj) {
  if (methodObj && methodObj.payoutChannel && methodObj.payoutChannel !== "") return methodObj.payoutChannel;
  var specific = await getConfig("payout_channel_" + method.toLowerCase(), null);
  if (specific && specific !== "Not Set") return specific;
  return await getPayoutChannel(method);
}

async function logBalanceHistory(userId, action, amount) {
  try {
    await BalanceHistory.create({ userId, action, amount });
  } catch (e) {
    console.error("logBalanceHistory:", e.message);
  }
}

async function logAdminAction(adminId, adminName, action, details = "", amount = 0, targetUserId = null) {
  try {
    await AdminLog.create({ adminId, adminName, action, details, amount, targetUserId });
  } catch (e) {
    console.error("logAdminAction:", e.message);
  }
}

async function buildKeyboardFromLayout(userId) {
  var userPref = await UserPreference.findOne({ userId: userId }).lean();
  var layout;
  if (userPref && userPref.keyboardLayout && userPref.keyboardLayout.length > 0) layout = userPref.keyboardLayout;
  else {
    var freshConfig = await Config.findOne({ key: "keyboard_layout" }).lean();
    layout = (freshConfig && freshConfig.value) ? freshConfig.value : DEFAULT_KEYBOARD_LAYOUT;
    configCache.data["keyboard_layout"] = layout;
  }
  var keyboardRows = [];
  var maxRow = layout.length > 0 ? Math.max.apply(null, layout.map(function(b) { return b.row; })) : 0;
  for (var r = 0; r <= maxRow; r++) {
    var rowButtons = layout.filter(function(b) { return b.row === r && !b.hidden; });
    if (rowButtons.length > 0) {
      var row = rowButtons.map(function(btn) {
        var b = { text: btn.name };
        if (btn.style && ["primary", "success", "danger"].indexOf(btn.style) >= 0) b.style = btn.style;
        return b;
      });
      keyboardRows.push(row);
    }
  }
  if (keyboardRows.length === 0) keyboardRows = [[{ text: `💸 ${toSmallCaps("My Balance")}` }]];
  return { keyboard: keyboardRows, resize_keyboard: true, is_persistent: false, one_time_keyboard: false };
}

async function getCurrentKeyboardLayoutForUser(userId) {
  let userPref = await UserPreference.findOne({ userId }).lean();
  if (userPref && userPref.keyboardLayout && userPref.keyboardLayout.length > 0) {
    return userPref.keyboardLayout;
  }
  return configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
}

async function saveUserKeyboard(userId, layout) {
  await UserPreference.findOneAndUpdate(
    { userId },
    { keyboardLayout: layout, updatedAt: new Date() },
    { upsert: true }
  );
}

async function buildStyledKb(buttons) {
  return { inline_keyboard: buttons };
}

async function getActiveKeyboardLayout() {
  let layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  return layout.filter(b => !b.hidden);
}

async function getActiveAdminPanelLayout() {
  let layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  return layout.filter(b => !b.hidden);
}

async function getUserFont(userId) {
  let pref = await UserPreference.findOne({ userId }).lean();
  return (pref && pref.fontPreference) ? pref.fontPreference : "normal";
}

async function sendUnknownCommand(ctx) {
  try {
    let active = await getConfig("unknown_command_active", false);
    if (!active) return;
    let text = await getConfig("unknown_command_text", "I didn't understand that.\n\nPlease /start the bot again.");
    let plainText = String(text).replace(/<[^>]*>/g, "");
    return ctx.reply(plainText, {
      link_preview_options: { is_disabled: true }
    }).catch(() => { });
  } catch (e) { }
}

async function animateProcessing(ctx, messageId, chatId, durationMs = 30000) {
  let frame = 0;
  const startTime = Date.now();
  const interval = setInterval(async () => {
    if (Date.now() - startTime > durationMs) {
      clearInterval(interval);
      return;
    }
    try {
      await bot.api.editMessageText(chatId, messageId,
        `⏳ ${toSmallCaps("Processing")} ${buildProcessingDots(frame)}`,
        { parse_mode: "HTML" }
      );
    } catch (e) { }
    frame++;
  }, 400);
  return interval;
}

async function processGatewayPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gatewayInfo = opts.gatewayInfo;
    var wallet = opts.wallet;
    var channelList = opts.channelList || [];
    var urlTemplate = gatewayInfo.url_template || gatewayInfo.url || "";
    var finalUrl = urlTemplate
      .replace(/{wallet}/g, encodeURIComponent(wallet))
      .replace(/{number}/g, encodeURIComponent(wallet))
      .replace(/{amount}/g, encodeURIComponent(payoutAmount))
      .replace(/{userId}/g, encodeURIComponent(userId))
      .replace(/{orderId}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{txnId}/g, encodeURIComponent("TXN" + Date.now()))
      .replace(/{timestamp}/g, encodeURIComponent(Date.now()));
    var response, resData;
    try {
      response = await axios.get(finalUrl, { timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message || 'Gateway request failed';
      return { status: 'error', message: apiMsg };
    }
    var isSuccess = false;
    var txnNumber = null;
    try {
      var data = response.data;
      var jsonData = null;
      if (typeof data === 'string') { try { jsonData = JSON.parse(data); } catch (e) { } }
      else if (data && typeof data === 'object') jsonData = data;
      if (jsonData) {
        isSuccess = jsonData.status === 'success' || jsonData.status === 'Success' || jsonData.success === true || jsonData.code === 200 || jsonData.status === 'ok';
        txnNumber = jsonData.txn_id || jsonData.txnNumber || jsonData.transaction_id || jsonData.txnId || jsonData.orderId || null;
      }
      if (!isSuccess && resData) {
        if (/failed|error|declined|invalid|insufficient/i.test(resData)) isSuccess = false;
        else if (/success|completed|done|paid|processed|ok/i.test(resData)) isSuccess = true;
      }
    } catch (parseErr) { }
    if (!isSuccess) {
      var errMsg = 'Gateway declined';
      if (response.data && response.data.message) errMsg = response.data.message;
      else if (resData && resData.length < 100) errMsg = resData;
      return { status: 'failed', message: errMsg, rawResponse: resData ? resData.substring(0, 300) : '' };
    }
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedWallet = halfMaskWallet(wallet);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Withdrawal Processed \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedWallet + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnNumber || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    for (var i = 0; i < channelList.length; i++) {
      if (channelList[i]) try { await bot.api.sendMessage(channelList[i], msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnNumber || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function processAutoUpiPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gateway = opts.gateway;
    var upiId = opts.upiId;
    var apiUrl = gateway.apiUrl || "";
    var method = (gateway.method || "GET").toUpperCase();
    var token = gateway.apiKey || "";
    var finalUrl = apiUrl;
    if (finalUrl.indexOf("{upi_id}") >= 0 || finalUrl.indexOf("{upi}") >= 0 || finalUrl.indexOf("{amount}") >= 0) {
      finalUrl = finalUrl.replace(/{upi_id}/g, encodeURIComponent(upiId)).replace(/{upi}/g, encodeURIComponent(upiId)).replace(/{amount}/g, payoutAmount).replace(/{token}/g, token);
      if (token && finalUrl.indexOf("token=") < 0 && finalUrl.indexOf(token) < 0) finalUrl += (finalUrl.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token);
    } else {
      finalUrl = apiUrl + (apiUrl.indexOf("?") >= 0 ? "&" : "?") + (token ? "token=" + encodeURIComponent(token) + "&" : "") + "upi=" + encodeURIComponent(upiId) + "&amount=" + payoutAmount + "&order_id=AUTO" + Date.now();
    }
    var response, resData;
    try {
      response = await axios({ method: method, url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg2 = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message;
      return { status: 'error', message: apiMsg2 };
    }
    var isSuccess = false, txnId = null;
    try {
      var data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (e) { }
    if (!isSuccess) return { status: 'failed', message: (response.data && response.data.message) || 'Gateway declined', rawResponse: resData ? resData.substring(0, 300) : '' };
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedUPI = halfMaskUPI(upiId);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Auto UPI Withdrawal \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedUPI + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnId || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    var payoutChannel = await getMethodPayoutChannel("auto_upi", gateway);
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function processAutoBankPayout(opts) {
  try {
    var bot = opts.bot;
    var userId = opts.userId;
    var amount = opts.amount;
    var payoutAmount = opts.payoutAmount;
    var gateway = opts.gateway;
    var bankAccNo = opts.bankAccNo;
    var bankIfsc = opts.bankIfsc;
    var finalUrl = gateway.apiUrl
      .replace(/{account}/g, encodeURIComponent(bankAccNo))
      .replace(/{acc_no}/g, encodeURIComponent(bankAccNo))
      .replace(/{ifsc}/g, encodeURIComponent(bankIfsc))
      .replace(/{amount}/g, payoutAmount)
      .replace(/{comment}/g, encodeURIComponent("WD" + Date.now()))
      .replace(/{userId}/g, userId);
    var response, resData;
    try {
      response = await axios({ method: (gateway.method || "GET").toUpperCase(), url: finalUrl, timeout: 30000 });
      try { resData = JSON.stringify(response.data); } catch (e) { resData = String(response.data); }
    } catch (apiErr) {
      var apiMsg3 = (apiErr.response && apiErr.response.data && apiErr.response.data.message) || apiErr.message;
      return { status: 'error', message: apiMsg3 };
    }
    var isSuccess = false, txnId = null;
    try {
      var data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { } }
      if (data && typeof data === 'object') {
        isSuccess = data.status === 'success' || data.status === 'Success' || data.success === true;
        txnId = data.txn_id || data.transaction_id || data.order_id || null;
      }
      if (!isSuccess && resData && /success|completed|done|paid/i.test(resData)) isSuccess = true;
    } catch (e) { }
    if (!isSuccess) return { status: 'failed', message: (response.data && response.data.message) || 'Gateway declined', rawResponse: resData ? resData.substring(0, 300) : '' };
    var user = await User.findOne({ userId: userId });
    if (!user) return { status: 'error', message: 'User not found' };
    var maskedBank = halfMaskBank(bankAccNo);
    var cleanResponse = removeUPIFieldsFromResponse(resData);
    var now = new Date();
    var msg = "\u2705 New Auto Bank Withdrawal \u2705\n\n" +
      "\uD83D\uDFE2 User : " + userId + "\n" +
      "\u270C\uFE0FOld Balance :- " + RUPEE + (user.balance + amount).toFixed(2) + "\n" +
      "\u270C\uFE0FRemaining Balance :- " + RUPEE + user.balance.toFixed(2) + "\n\n" +
      "\uD83D\uDE80Amount : " + RUPEE + payoutAmount.toFixed(2) + " INR ( " + RUPEE + (amount - payoutAmount).toFixed(2) + " Tax )\n" +
      "\u26D4 Address : " + maskedBank + "\n" +
      "\uD83D\uDCB3 Payment Ref : " + (txnId || generateTxnNumber()) + "\n\n" +
      "\uD83D\uDD52 Time : " + formatDateTime(now) + "\n\n" +
      "\uD83D\uDCA1 Bot : @" + (bot.botInfo ? bot.botInfo.username : "Bot") + "\n\n" +
      "\u26A0\uFE0FGateway Response :- " + cleanResponse;
    var payoutChannel = await getMethodPayoutChannel("auto_bank", gateway);
    if (payoutChannel && payoutChannel !== "Not Set") {
      try { await bot.api.sendMessage(payoutChannel, msg, { parse_mode: "HTML" }).catch(function() { }); } catch (e) { }
    }
    return { status: 'success', txnNumber: txnId || generateTxnNumber(), rawResponse: resData };
  } catch (e) { return { status: 'error', message: e.message }; }
}

async function atomicWithdraw(userId, amount, taxAmount, method, details, txnNumber, paymentRef, isGateway, gatewayName, gatewayResponse) {
  var user = await User.findOne({ userId: userId });
  if (!user) return null;
  var oldBalance = user.balance;
  if (oldBalance < amount) return null;
  user.balance -= amount;
  user.withdrawnTotal = (user.withdrawnTotal || 0) + amount;
  await user.save();
  var newBalance = user.balance;
  var approvedCount = await Withdrawal.countDocuments({ userId: userId, status: "Approved" });
  var userWithdrawalCount = approvedCount + 1;
  var withdrawalId = Math.floor(100000 + Math.random() * 900000).toString();
  await Withdrawal.create({
    withdrawalId: withdrawalId,
    userId: userId,
    userWithdrawalCount: userWithdrawalCount,
    amount: amount,
    method: method,
    details: details,
    status: isGateway ? "Approved" : "Pending",
    isGateway: isGateway,
    gatewayName: gatewayName || "",
    gatewayResponse: gatewayResponse || "",
    txnNumber: txnNumber || "",
    paymentRef: paymentRef || "",
    taxAmount: taxAmount,
    netAmount: amount - taxAmount,
    oldBalance: oldBalance,
    newBalance: newBalance,
    approvedBy: isGateway ? "Auto" : "",
    approvedAt: isGateway ? new Date() : null
  });
  if (taxAmount > 0) {
    var ownerId = await getConfig("owner_id", MAIN_OWNER_ID);
    await User.findOneAndUpdate({ userId: ownerId }, { $inc: { balance: taxAmount } });
    await logBalanceHistory(ownerId, "Withdrawal Tax (" + method + ")", taxAmount);
  }
  await logBalanceHistory(userId, "Withdrawn via " + method, -amount);
  return { withdrawalId: withdrawalId, userWithdrawalCount: userWithdrawalCount, oldBalance: oldBalance, newBalance: newBalance };
}

bot.callbackQuery("adm_tax_menu", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var text = "<b>\uD83D\uDCB0 Set Tax Slabs</b>\n\nSelect method to configure tax:";
  var kb = new InlineKeyboard();
  var gateways = await Gateway.find({}).lean();
  for (var i = 0; i < gateways.length; i++) kb.row({ text: "\uD83C\uDF10 " + gateways[i].name, callback_data: "tax_edit_gw_" + gateways[i].name, style: "primary" });
  var autoUpis = await AutoUpi.find({}).lean();
  for (var j = 0; j < autoUpis.length; j++) kb.row({ text: "\u26A1 " + autoUpis[j].name, callback_data: "tax_edit_upi_" + autoUpis[j].gatewayId, style: "primary" });
  var autoBanks = await AutoBank.find({}).lean();
  for (var k = 0; k < autoBanks.length; k++) kb.row({ text: "\uD83C\uDFE6 " + autoBanks[k].name, callback_data: "tax_edit_bank_" + autoBanks[k].gatewayId, style: "primary" });
  var methods = ["upi", "bank", "amazon", "redeem"];
  for (var m = 0; m < methods.length; m++) kb.row({ text: methods[m].toUpperCase(), callback_data: "tax_edit_manual_" + methods[m], style: "primary" });
  kb.row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

async function renderTaxSlabPage(ctx, slabs, type, identifier) {
  var bodyText = "";
  if (slabs.length === 0) bodyText = "\u274C No tax slabs added";
  else slabs.forEach(function(s, i) { bodyText += (i + 1) + ". " + RUPEE + s.min + " \u2192 " + RUPEE + s.max + " = " + RUPEE + s.tax + "\n"; });
  var text = "<b>\uD83D\uDCB0 Tax</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard();
  for (var i = 0; i < slabs.length; i++) {
    var s = slabs[i];
    kb.row(
      { text: RUPEE + s.min + "-" + RUPEE + s.max + " = " + RUPEE + s.tax, callback_data: "tax_view_" + type + "_" + identifier + "_" + i, style: "success" },
      { text: "\u270F\uFE0F", callback_data: "tax_edit_" + type + "_" + identifier + "_" + i, style: "primary" },
      { text: "\u274C", callback_data: "tax_del_" + type + "_" + identifier + "_" + i, style: "danger" }
    );
  }
  kb.row({ text: "\u2795 Add Tax", callback_data: "tax_add_" + type + "_" + identifier, style: "success" });
  kb.row({ text: "Back", callback_data: "adm_tax_menu", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
}

async function getSlabsForType(type, identifier) {
  if (type === "gw") { var gw = await Gateway.findOne({ name: identifier }).lean(); return gw ? (gw.taxSlabs || []) : []; }
  if (type === "upi") { var gw2 = await AutoUpi.findOne({ gatewayId: identifier }).lean(); return gw2 ? (gw2.taxSlabs || []) : []; }
  if (type === "bank") { var gw3 = await AutoBank.findOne({ gatewayId: identifier }).lean(); return gw3 ? (gw3.taxSlabs || []) : []; }
  if (type === "manual") { var s = await WithdrawSettings.findOne({ method: identifier }).lean(); return s ? (s.taxSlabs || []) : []; }
  return [];
}

async function saveSlabsForType(type, identifier, slabs) {
  if (type === "gw") await Gateway.updateOne({ name: identifier }, { taxSlabs: slabs, updatedAt: new Date() });
  else if (type === "upi") await AutoUpi.updateOne({ gatewayId: identifier }, { taxSlabs: slabs });
  else if (type === "bank") await AutoBank.updateOne({ gatewayId: identifier }, { taxSlabs: slabs });
  else if (type === "manual") { var s = await WithdrawSettings.findOne({ method: identifier }); if (!s) await WithdrawSettings.create({ method: identifier, taxSlabs: slabs }); else { s.taxSlabs = slabs; s.updatedAt = new Date(); await s.save(); } }
}

bot.callbackQuery(/^tax_edit_gw_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("tax_edit_gw_", "");
  var gw = await Gateway.findOne({ name: name }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "gw", name);
});

bot.callbackQuery(/^tax_edit_upi_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("tax_edit_upi_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "upi", gwId);
});

bot.callbackQuery(/^tax_edit_bank_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("tax_edit_bank_", "");
  var gw = await AutoBank.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  await renderTaxSlabPage(ctx, gw.taxSlabs || [], "bank", gwId);
});

bot.callbackQuery(/^tax_edit_manual_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("tax_edit_manual_", "");
  var s = await WithdrawSettings.findOne({ method: method }).lean();
  await renderTaxSlabPage(ctx, (s && s.taxSlabs) || [], "manual", method);
});

bot.callbackQuery(/^tax_add_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_add_", "");
  var parts = data.split("_");
  var type = parts[0];
  var identifier = parts.slice(1).join("_");
  userState[ctx.from.id] = "TAX_ADD_" + type + "_" + identifier;
  await ctx.editMessageText("<b>\uD83D\uDCB0 Add Tax</b>\n\nSend Your Tax:\n\nFormat: <code>min max tax</code>\nExample: <code>10 20 4</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^tax_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_edit_", "");
  var parts = data.split("_");
  var type = parts[0];
  var idx = parseInt(parts[parts.length - 1], 10);
  var identifier = parts.slice(1, -1).join("_");
  var slabs = await getSlabsForType(type, identifier);
  if (!slabs[idx]) return;
  userState[ctx.from.id] = "TAX_EDIT_" + type + "_" + identifier + "_" + idx;
  await ctx.editMessageText("<b>\uD83D\uDCB0 Edit Tax</b>\n\nCurrent: " + RUPEE + slabs[idx].min + " \u2192 " + RUPEE + slabs[idx].max + " = " + RUPEE + slabs[idx].tax + "\n\nSend Your Tax:\n\nFormat: <code>min max tax</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^tax_del_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("tax_del_", "");
  var parts = data.split("_");
  var type = parts[0];
  var idx = parseInt(parts[parts.length - 1], 10);
  var identifier = parts.slice(1, -1).join("_");
  var slabs = await getSlabsForType(type, identifier);
  if (!slabs[idx]) return;
  slabs.splice(idx, 1);
  await saveSlabsForType(type, identifier, slabs);
  await renderTaxSlabPage(ctx, slabs, type, identifier);
});

const STYLE_OPTIONS = [
  { key: "success", name: "\uD83D\uDFE2 Green", emoji: "\uD83D\uDFE2" },
  { key: "danger", name: "\uD83D\uDD34 Red", emoji: "\uD83D\uDD34" },
  { key: "primary", name: "\uD83D\uDD35 Blue", emoji: "\uD83D\uDD35" },
  { key: "", name: "\u26AA No Color", emoji: "\u26AA" }
];

bot.callbackQuery("adm_keyboard_custom", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var text = "<b>\u2328\uFE0F Keyboard Buttons Customizing</b>\n\n\uD83D\uDC47 Manage your keyboard buttons:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < layout.length; i++) {
    var btn = layout[i];
    var icon = btn.hidden ? "\uD83D\uDE48" : "\uD83D\uDC41\uFE0F";
    var styleIcon = btn.style === "success" ? "\uD83D\uDFE2" : btn.style === "danger" ? "\uD83D\uDD34" : btn.style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    var label = btn.name.substring(0, 20);
    kb.row(
      { text: label, callback_data: "kbc_view_" + btn.key, style: "primary" },
      { text: "\u270F\uFE0F", callback_data: "kbc_edit_" + btn.key, style: "primary" },
      { text: styleIcon, callback_data: "kbc_style_" + btn.key, style: btn.style === "success" ? "success" : btn.style === "danger" ? "danger" : "primary" },
      { text: icon, callback_data: "kbc_toggle_" + btn.key, style: btn.hidden ? "danger" : "success" }
    );
  }
  kb.row({ text: "Reset to Default", callback_data: "kbc_reset", style: "danger" });
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_view_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(function() { });
  var text = "<b>Button Info</b>\n\n\uD83D\uDCDD Name: " + btn.name + "\n\uD83D\uDD11 Key: <code>" + btn.key + "</code>\n\uD83D\uDCCA Row: " + btn.row + "\n\uD83C\uDFA8 Style: " + (btn.style || "No Color") + "\n\uD83D\uDC41\uFE0F Status: " + (btn.hidden ? "\uD83D\uDD34 Hidden" : "\uD83D\uDFE2 Visible");
  var kb = new InlineKeyboard()
    .row({ text: "\u270F\uFE0F Edit Name", callback_data: "kbc_edit_" + btnKey, style: "primary" })
    .row({ text: "\uD83C\uDFA8 Change Color", callback_data: "kbc_style_" + btnKey, style: "primary" })
    .row({ text: btn.hidden ? "Show" : "Hide", callback_data: "kbc_toggle_" + btnKey, style: btn.hidden ? "success" : "danger" })
    .row({ text: "Move Up", callback_data: "kbc_up_" + btnKey, style: "primary" }, { text: "Move Down", callback_data: "kbc_down_" + btnKey, style: "primary" })
    .row({ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_edit_", "");
  userState[ctx.from.id] = "KBC_EDIT_NAME_" + btnKey;
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  await ctx.editMessageText("\u270F\uFE0F <b>Edit Button Name</b>\n\n\uD83D\uDCCC Current: " + (btn ? btn.name : "") + "\n\n\uD83D\uDCDD Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_keyboard_custom", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^kbc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("kbc_style_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = btn.style === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "kbc_setstyle_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color for " + btn.name + "</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^kbc_setstyle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("kbc_setstyle_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (btn) {
    btn.style = style === "none" ? "" : style;
    configCache.data["keyboard_layout"] = layout;
    await setConfig("keyboard_layout", layout);
  }
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated! Use back to continue.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_keyboard_custom", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery(/^kbc_toggle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_toggle_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["keyboard_layout"] = layout;
  await setConfig("keyboard_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "\uD83D\uDE48 Hidden" : "\uD83D\uDC41\uFE0F Visible" }).catch(function() { });
});

bot.callbackQuery(/^kbc_up_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_up_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var idx = layout.findIndex(function(b) { return b.key === btnKey; });
  if (idx > 0) { var temp = layout[idx].row; layout[idx].row = layout[idx - 1].row; layout[idx - 1].row = temp; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2B06\uFE0F" }).catch(function() { });
});

bot.callbackQuery(/^kbc_down_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("kbc_down_", "");
  var layout = configCache.data["keyboard_layout"] || DEFAULT_KEYBOARD_LAYOUT;
  var idx = layout.findIndex(function(b) { return b.key === btnKey; });
  if (idx < layout.length - 1) { var temp = layout[idx].row; layout[idx].row = layout[idx + 1].row; layout[idx + 1].row = temp; configCache.data["keyboard_layout"] = layout; await setConfig("keyboard_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2B07\uFE0F" }).catch(function() { });
});

bot.callbackQuery("kbc_reset", async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  configCache.data["keyboard_layout"] = DEFAULT_KEYBOARD_LAYOUT;
  await setConfig("keyboard_layout", DEFAULT_KEYBOARD_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(function() { });
});

bot.callbackQuery("adm_inline_colors", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var inlineButtons = [
    { key: "balance_statement", name: "\uD83D\uDCCA Balance Statement" },
    { key: "live_fund", name: "\uD83D\uDCB0 Live Fund" },
    { key: "refresh_balance_only", name: "\uD83D\uDD04 Refresh Balance" },
    { key: "check_join", name: "\u2705 Claim Join" }
  ];
  var styles = await getConfig("inline_button_styles", {});
  var text = "<b>\uD83C\uDFA8 Inline Button Colors</b>\n\n\uD83D\uDC47 Manage colors for each inline button:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < inlineButtons.length; i++) {
    var btn = inlineButtons[i];
    var style = styles[btn.key] || "";
    var styleIcon = style === "success" ? "\uD83D\uDFE2" : style === "danger" ? "\uD83D\uDD34" : style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    kb.row({ text: styleIcon + " " + btn.name, callback_data: "ibc_style_" + btn.key, style: style === "success" ? "success" : style === "danger" ? "danger" : "primary" });
  }
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^ibc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("ibc_style_", "");
  var styles = await getConfig("inline_button_styles", {});
  var cur = styles[btnKey] || "";
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = cur === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "ibc_set_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_inline_colors", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^ibc_set_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("ibc_set_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var styles = await getConfig("inline_button_styles", {});
  styles[btnKey] = style === "none" ? "" : style;
  await setConfig("inline_button_styles", styles);
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated! Use back to continue.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_inline_colors", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery("adm_panel_custom", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var text = "<b>Admin Panel Customizing</b>\n\n\uD83D\uDC47 Manage admin panel buttons:";
  var kb = new InlineKeyboard();
  for (var i = 0; i < layout.length; i++) {
    var btn = layout[i];
    var icon = btn.hidden ? "\uD83D\uDE48" : "\uD83D\uDC41\uFE0F";
    var styleIcon = btn.style === "success" ? "\uD83D\uDFE2" : btn.style === "danger" ? "\uD83D\uDD34" : btn.style === "primary" ? "\uD83D\uDD35" : "\u26AA";
    var label = btn.name.substring(0, 20);
    kb.row(
      { text: label, callback_data: "apc_view_" + btn.key, style: "primary" },
      { text: styleIcon, callback_data: "apc_style_" + btn.key, style: btn.style === "success" ? "success" : btn.style === "danger" ? "danger" : "primary" },
      { text: icon, callback_data: "apc_toggle_" + btn.key, style: btn.hidden ? "danger" : "success" }
    );
  }
  kb.row({ text: "Reset to Default", callback_data: "apc_reset", style: "danger" });
  kb.row({ text: "Back to Theme", callback_data: "adm_customize_theme", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_view_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(function() { });
  var text = "<b>Button Info</b>\n\n\uD83D\uDCDD Name: " + btn.name + "\n\uD83D\uDD11 Key: <code>" + btn.key + "</code>\n\uD83C\uDFA8 Style: " + (btn.style || "No Color") + "\n\uD83D\uDC41\uFE0F Status: " + (btn.hidden ? "\uD83D\uDD34 Hidden" : "\uD83D\uDFE2 Visible");
  var kb = new InlineKeyboard()
    .row({ text: "\u270F\uFE0F Edit Name", callback_data: "apc_edit_" + btnKey, style: "primary" })
    .row({ text: "\uD83C\uDFA8 Change Color", callback_data: "apc_style_" + btnKey, style: "primary" })
    .row({ text: btn.hidden ? "Show" : "Hide", callback_data: "apc_toggle_" + btnKey, style: btn.hidden ? "success" : "danger" })
    .row({ text: "Back", callback_data: "adm_panel_custom", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_edit_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_edit_", "");
  userState[ctx.from.id] = "APC_EDIT_NAME_" + btnKey;
  await ctx.editMessageText("\u270F\uFE0F <b>Edit Button Name</b>\n\n\uD83D\uDCDD Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_panel_custom", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^apc_style_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var btnKey = ctx.callbackQuery.data.replace("apc_style_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  var kb = new InlineKeyboard();
  for (var i = 0; i < STYLE_OPTIONS.length; i++) {
    var opt = STYLE_OPTIONS[i];
    var check = btn.style === opt.key ? "\u2705 " : "";
    var style = opt.key === "success" ? "success" : opt.key === "danger" ? "danger" : "primary";
    kb.row({ text: check + opt.name, callback_data: "apc_setstyle_" + btnKey + "_" + (opt.key || "none"), style: style });
  }
  kb.row({ text: "Back", callback_data: "adm_panel_custom", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFA8 <b>Select Color for " + btn.name + "</b>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^apc_setstyle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var data = ctx.callbackQuery.data.replace("apc_setstyle_", "");
  var parts = data.split("_");
  var style = parts.pop();
  var btnKey = parts.join("_");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (btn) { btn.style = style === "none" ? "" : style; configCache.data["admin_panel_layout"] = layout; await setConfig("admin_panel_layout", layout); }
  await ctx.answerCallbackQuery({ text: "\u2705 Color updated!" }).catch(function() { });
  await ctx.editMessageText("\u2705 Color updated!", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "adm_panel_custom", style: "primary" }]] } }).catch(function() { });
});

bot.callbackQuery(/^apc_toggle_/, async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  var btnKey = ctx.callbackQuery.data.replace("apc_toggle_", "");
  var layout = configCache.data["admin_panel_layout"] || DEFAULT_ADMIN_PANEL_LAYOUT;
  var btn = layout.find(function(b) { return b.key === btnKey; });
  if (!btn) return;
  btn.hidden = !btn.hidden;
  configCache.data["admin_panel_layout"] = layout;
  await setConfig("admin_panel_layout", layout);
  await ctx.answerCallbackQuery({ text: btn.hidden ? "\uD83D\uDE48 Hidden" : "\uD83D\uDC41\uFE0F Visible" }).catch(function() { });
});

bot.callbackQuery("apc_reset", async function(ctx) {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(function() { });
  configCache.data["admin_panel_layout"] = DEFAULT_ADMIN_PANEL_LAYOUT;
  await setConfig("admin_panel_layout", DEFAULT_ADMIN_PANEL_LAYOUT);
  await ctx.answerCallbackQuery({ text: "Reset!" }).catch(function() { });
});

bot.callbackQuery("adm_user_update", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "USER_UPDATE_BROADCAST";
  await ctx.editMessageText("\uD83D\uDCE2 <b>User Update Broadcast</b>\n\nSend your update message to send to all users:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "admin", style: "danger" }]] } }).catch(function() { });
});

async function handleUserUpdateBroadcast(ctx, text, userId) {
  delete userState[userId];
  var html = entitiesToHtml(text, ctx.message.entities || []);
  var users = await User.find({}).lean();
  var sent = 0, failed = 0;
  for (var ui = 0; ui < users.length; ui++) {
    try {
      await bot.api.sendMessage(users[ui].userId, html, { parse_mode: "HTML" }).catch(function() { throw new Error("x"); });
      sent++;
      await new Promise(function(r) { setTimeout(r, 40); });
    } catch (e) { failed++; }
  }
  await ctx.reply("<b>User Update Complete!</b>\n\n<blockquote>\u2705 Sent: " + sent + "\n\u274C Failed: " + failed + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admin", style: "primary" }]] } }).catch(function() { });
  return true;
}

bot.callbackQuery("adm_auto_bank", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var banks = await AutoBank.find({}).sort({ createdAt: 1 }).lean();
  var total = banks.length;
  var active = banks.filter(function(b) { return b.status === "active"; }).length;
  var bodyText = "Total: " + total + " | \uD83D\uDFE2 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No Auto Bank gateways configured.";
  else banks.forEach(function(b, i) { bodyText += (i + 1) + ". \uD83C\uDFE6 " + b.name + "\n   " + (b.status === "active" ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF") + "\n\n"; });
  var kb = new InlineKeyboard().row({ text: "\u2795 Add New Auto Bank", callback_data: "auto_bank_add", style: "success" });
  for (var i = 0; i < banks.length; i++) {
    var b = banks[i];
    var icon = b.status === "active" ? "\uD83D\uDFE2" : "\uD83D\uDD34";
    kb.row({ text: icon + " " + b.name, callback_data: "auto_bank_view_" + b.gatewayId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFE6 <b>Auto Bank</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery("auto_bank_add", async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_BANK_ADD";
  await ctx.editMessageText("\u2795 <b>Add Auto Bank</b>\n\nFormat:\n<code>NAME::URL</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_bank", style: "danger" }]] } }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_view_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_view_", "");
  var bank = await AutoBank.findOne({ gatewayId: gwId }).lean();
  if (!bank) return;
  var statusIcon = bank.status === "active" ? "\uD83D\uDFE2 ON" : "\uD83D\uDD34 OFF";
  var bodyText = "Status: " + statusIcon + "\nMin: " + RUPEE + (bank.minAmount || 0) + " | Max: " + RUPEE + (bank.maxAmount || 0) + "\nTax Slabs: " + (bank.taxSlabs || []).length + "\nPayout: " + (bank.payoutChannel || "Default") + "\n\nURL:\n<code>" + bank.apiUrl + "</code>";
  var kb = new InlineKeyboard()
    .row({ text: bank.status === "active" ? "\uD83D\uDD34 Turn OFF" : "\uD83D\uDFE2 Turn ON", callback_data: "auto_bank_toggle_" + gwId, style: bank.status === "active" ? "danger" : "success" })
    .row({ text: "\uD83D\uDCB0 Set Tax Slabs", callback_data: "tax_edit_bank_" + gwId, style: "success" })
    .row({ text: "\uD83D\uDCE2 Set Payout Channel", callback_data: "auto_bank_set_payout_" + gwId, style: "primary" })
    .row({ text: "\uD83D\uDDD1\uFE0F Delete", callback_data: "auto_bank_del_" + gwId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_auto_bank", style: "primary" });
  await ctx.editMessageText("\uD83C\uDFE6 <b>" + bank.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_toggle_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_toggle_", "");
  var bank = await AutoBank.findOne({ gatewayId: gwId });
  if (bank) { bank.status = bank.status === "active" ? "off" : "active"; await bank.save(); }
  await ctx.answerCallbackQuery({ text: "Toggled" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_del_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_del_", "");
  await AutoBank.deleteOne({ gatewayId: gwId });
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(function() { });
});

bot.callbackQuery(/^auto_bank_set_payout_/, async function(ctx) {
  ctx.answerCallbackQuery().catch(function() { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_bank_set_payout_", "");
  userState[ctx.from.id] = "AUTO_BANK_PAYOUT_" + gwId;
  await ctx.editMessageText("\uD83D\uDCE2 Send Payout Channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_bank_view_" + gwId, style: "danger" }]] } }).catch(function() { });
});

async function handleAutoBankInput(ctx, text, userId, state) {
  if (state === "AUTO_BANK_ADD") {
    delete userState[userId];
    var parts = text.trim().split("::").map(function(p) { return p.trim(); });
    var name, url;
    if (parts.length === 2) { name = parts[0].toUpperCase().replace(/\s+/g, "_"); url = parts[1]; }
    else { name = "BANK_" + Date.now().toString().slice(-6); url = text.trim(); }
    if (url.indexOf("http") !== 0) { await ctx.reply("\u274C Invalid URL!").catch(function() { }); return true; }
    var gwId = "ABG" + Date.now().toString().slice(-8);
    await AutoBank.create({ gatewayId: gwId, name: name, apiUrl: url, status: "active", minAmount: 0, maxAmount: 0, taxSlabs: [] });
    await ctx.reply("\u2705 <b>Auto Bank Added!</b>\n\n\uD83C\uDF10 " + name + "\n\uD83D\uDFE2 ON\nURL:\n<code>" + url + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View", callback_data: "auto_bank_view_" + gwId, style: "primary" }], [{ text: "Back", callback_data: "adm_auto_bank", style: "primary" }]] } }).catch(function() { });
    return true;
  }
  if (state.indexOf("AUTO_BANK_PAYOUT_") === 0) {
    var gwId2 = state.replace("AUTO_BANK_PAYOUT_", "");
    delete userState[userId];
    try { await ctx.api.getChat(text.trim()); } catch (e) { await ctx.reply("\u274C Cannot access channel!").catch(function() { }); return true; }
    await AutoBank.updateOne({ gatewayId: gwId2 }, { payoutChannel: text.trim() });
    await ctx.reply("\u2705 Payout Channel set!", { reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_bank_view_" + gwId2, style: "primary" }]] } }).catch(function() { });
    return true;
  }
  return false;
}

async function handleAdminTaxInput(ctx, text, userId, state) {
  if (state.indexOf("TAX_ADD_") === 0) {
    var data = state.replace("TAX_ADD_", "");
    var parts = data.split("_");
    var type = parts[0];
    var identifier = parts.slice(1).join("_");
    delete userState[userId];
    var slab = parseTaxSlabInput(text);
    if (!slab) { await ctx.reply("\u274C Invalid format!\n\nUse: <code>min max tax</code>\nExample: <code>10 20 4</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Try Again", callback_data: "tax_add_" + type + "_" + identifier, style: "primary" }], [{ text: "Back", callback_data: "tax_edit_" + type + "_" + identifier, style: "primary" }]] } }).catch(function() { }); return true; }
    var slabs = await getSlabsForType(type, identifier);
    slabs.push(slab);
    await saveSlabsForType(type, identifier, slabs);
    await renderTaxSlabPage(ctx, slabs, type, identifier);
    return true;
  }
  if (state.indexOf("TAX_EDIT_") === 0) {
    var data2 = state.replace("TAX_EDIT_", "");
    var parts2 = data2.split("_");
    var type2 = parts2[0];
    var idx2 = parseInt(parts2[parts2.length - 1], 10);
    var identifier2 = parts2.slice(1, -1).join("_");
    delete userState[userId];
    var slab2 = parseTaxSlabInput(text);
    if (!slab2) { await ctx.reply("\u274C Invalid format!\n\nUse: <code>min max tax</code>", { parse_mode: "HTML" }).catch(function() { }); return true; }
    var slabs2 = await getSlabsForType(type2, identifier2);
    if (!slabs2[idx2]) return true;
    slabs2[idx2] = slab2;
    await saveSlabsForType(type2, identifier2, slabs2);
    await renderTaxSlabPage(ctx, slabs2, type2, identifier2);
    return true;
  }
  return false;
}

bot.callbackQuery("adm_gateway_menu", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderWithdrawalStep(ctx);
});

async function renderWithdrawalStep(ctx) {
  var text = "🚀 <b>Withdrawal Step</b>\n\nChoose withdrawal method:";
  var kb = new InlineKeyboard()
    .row({ text: "🌐 Gateway", callback_data: "adm_gateway_list", style: "primary" })
    .row({ text: "⚡ Auto UPI", callback_data: "adm_auto_upi", style: "primary" })
    .row({ text: "🏦 Auto Bank Gateway", callback_data: "adm_auto_bank", style: "primary" })
    .row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_gateway_list", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderGatewayMenu(ctx);
});

async function renderGatewayMenu(ctx) {
  var gateways = await Gateway.find({}).sort({ createdAt: -1 }).lean();
  var total = gateways.length;
  var active = gateways.filter(function(g) { return g.isActive; }).length;
  var bodyText = "Total: " + total + " | 🟢 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No gateways configured.";
  else gateways.forEach(function(g, i) { bodyText += (i + 1) + ". 🌐 " + g.name + "\n   " + (g.isActive ? "🟢 ON" : "🔴 OFF") + "\n   🔗 " + (g.url_template || g.url).substring(0, 35) + "...\n\n"; });
  var kb = new InlineKeyboard().row({ text: "Add New Gateway", callback_data: "gw_add_new", style: "success" });
  for (var i = 0; i < gateways.length; i++) { var icon = gateways[i].isActive ? "🟢" : "🔴"; kb.row({ text: icon + " " + gateways[i].name, callback_data: "gw_view_" + gateways[i].name, style: "primary" }); }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("🌐 <b>Gateways</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("gw_add_new", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "GW_WAIT_NAME_V2";
  await ctx.editMessageText("🏦 Add New Gateway\n\n📝 Send Gateway Name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_gateway_list", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_view_", "");
  var gw = await Gateway.findOne({ name }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var urlShow = gw.url_template || gw.url || "";
  var bodyText = "URL:\n<code>" + urlShow + "</code>\n\nStatus: " + (gw.isActive ? "🟢 ON" : "🔴 OFF") + "\nMin: " + RUPEE + (gw.minAmount || 0) + "\nMax: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\nPayout: " + (gw.payoutChannel || "Default") + "\n\nCreated: " + formatDateTime(gw.createdAt);
  var kb = new InlineKeyboard()
    .row({ text: "Edit Settings", callback_data: "gw_edit_" + gw.name, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_gw_" + gw.name, style: "success" })
    .row({ text: "Set Payout Channel", callback_data: "gw_set_payout_" + gw.name, style: "primary" })
    .row({ text: gw.isActive ? "Turn OFF" : "Turn ON", callback_data: "gw_toggle_" + gw.name, style: gw.isActive ? "danger" : "success" })
    .row({ text: "Edit URL", callback_data: "gw_edit_url_" + gw.name, style: "primary" })
    .row({ text: "Delete Gateway", callback_data: "gw_del_" + gw.name, style: "danger" })
    .row({ text: "Back", callback_data: "adm_gateway_list", style: "primary" });
  await ctx.editMessageText("<b>Gateway: " + gw.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var name = ctx.callbackQuery.data.replace("gw_toggle_", "");
  var gw = await Gateway.findOne({ name });
  if (!gw) return;
  gw.isActive = !gw.isActive;
  gw.updatedAt = new Date();
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.isActive ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery(/^gw_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_edit_", "");
  var gw = await Gateway.findOne({ name });
  if (!gw) return;
  var text = "<b>" + name + " Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: " + (gw.isActive ? "ON" : "OFF") + "\nMin: " + RUPEE + (gw.minAmount || 0) + "\nMax: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  var kb = new InlineKeyboard()
    .row({ text: "Set Min", callback_data: "gw_min_" + name, style: "primary" })
    .row({ text: "Set Max", callback_data: "gw_max_" + name, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_gw_" + name, style: "success" })
    .row({ text: gw.isActive ? "Turn OFF" : "Turn ON", callback_data: "gw_toggle_" + name, style: gw.isActive ? "danger" : "success" })
    .row({ text: "Back", callback_data: "gw_view_" + name, style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^gw_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_min_", "");
  userState[ctx.from.id] = "GW_MIN_" + name;
  await ctx.editMessageText("Set Min Amount\n\nSend minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + name, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_max_", "");
  userState[ctx.from.id] = "GW_MAX_" + name;
  await ctx.editMessageText("Set Max Amount\n\nSend maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "gw_edit_" + name, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_edit_url_", "");
  userState[ctx.from.id] = "GW_EDIT_URL_" + name;
  var gw = await Gateway.findOne({ name }).lean();
  await ctx.editMessageText("<b>Edit Gateway URL</b>\n\n📛 " + name + "\n\nCurrent:\n<code>" + gw.url + "</code>\n\nSend new URL template:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "gw_view_" + name, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_set_payout_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var name = ctx.callbackQuery.data.replace("gw_set_payout_", "");
  userState[ctx.from.id] = "GW_PAYOUT_" + name;
  await ctx.editMessageText("📢 Send Payout Channel for " + name + ":", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "gw_view_" + name, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^gw_del_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var name = ctx.callbackQuery.data.replace("gw_del_", "");
  await Gateway.deleteOne({ name });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Gateway Deleted", name, 0, null);
  await ctx.answerCallbackQuery({ text: "Deleted!" }).catch(() => { });
  await renderGatewayMenu(ctx);
});

bot.callbackQuery("adm_auto_upi", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderAutoUpiMenu(ctx);
});

async function renderAutoUpiMenu(ctx) {
  var gateways = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();
  var total = gateways.length;
  var active = gateways.filter(function(g) { return g.status === "active"; }).length;
  var bodyText = "Total: " + total + " | 🟢 ON: " + active + "\n\n";
  if (total === 0) bodyText += "No Auto UPI gateways configured.";
  else gateways.forEach(function(g, i) { bodyText += (i + 1) + ". 🌐 " + g.name + "\n   " + (g.status === "active" ? "🟢 ON" : "🔴 OFF") + " | " + g.method + "\n\n"; });
  var kb = new InlineKeyboard().row({ text: "➕ Add New Auto UPI", callback_data: "auto_upi_add", style: "success" });
  for (var i = 0; i < gateways.length; i++) {
    var icon = gateways[i].status === "active" ? "🟢" : "🔴";
    kb.row({ text: icon + " " + gateways[i].name, callback_data: "auto_upi_view_" + gateways[i].gatewayId, style: "primary" });
  }
  kb.row({ text: "Back", callback_data: "adm_gateway_menu", style: "primary" });
  await ctx.editMessageText("⚡ <b>Auto UPI</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("auto_upi_add", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await ctx.editMessageText("➕ <b>Add New Auto UPI</b>\n\nChoose model:", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .row({ text: "📝 Simple Model", callback_data: "auto_upi_simple", style: "primary" })
      .row({ text: "⚙️ Advanced Model", callback_data: "auto_upi_advanced", style: "primary" })
      .row({ text: "Back", callback_data: "adm_auto_upi", style: "primary" })
  }).catch(() => { });
});

bot.callbackQuery("auto_upi_simple", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_SIMPLE_NAME";
  await ctx.editMessageText("📝 <b>Simple Model</b>\n\nStep 1 of 2\n\n📝 Send Gateway Name:\n\nExample:\nCASHFREE\nPHONEPE", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_upi", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("auto_upi_advanced", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "AUTO_UPI_ADVANCED_INPUT";
  await ctx.editMessageText("⚙️ <b>Advanced Model</b>\n\n📝 Send in single line:\n\nFormat:\n<code>NAME::METHOD::URL::TOKEN</code>\n\nExamples:\n<code>CASHFREE::GET::https://api.cashfree.com/payout::KEY123</code>\n<code>PHONEPE::POST::https://api.phonepe.com/payout</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_auto_upi", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_view_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_view_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  var statusIcon = gw.status === "active" ? "🟢 ON" : "🔴 OFF";
  var bodyText = "Status: " + statusIcon + "\nMethod: " + (gw.method || "GET") + "\nMin: " + RUPEE + (gw.minAmount || 0) + " | Max: " + RUPEE + (gw.maxAmount || 0) + "\nTax Slabs: " + (gw.taxSlabs || []).length + "\nPayout: " + (gw.payoutChannel || "Default") + "\n\nURL:\n<code>" + gw.apiUrl + "</code>";
  var kb = new InlineKeyboard()
    .row({ text: "✏️ Edit Settings", callback_data: "auto_upi_edit_" + gw.gatewayId, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_upi_" + gw.gatewayId, style: "success" })
    .row({ text: "Set Payout Channel", callback_data: "auto_upi_set_payout_" + gw.gatewayId, style: "primary" })
    .row({ text: gw.status === "active" ? "🔴 Turn OFF" : "🟢 Turn ON", callback_data: "auto_upi_toggle_" + gw.gatewayId, style: gw.status === "active" ? "danger" : "success" })
    .row({ text: "🗑️ Delete", callback_data: "auto_upi_del_" + gw.gatewayId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_auto_upi", style: "primary" });
  await ctx.editMessageText("🌐 <b>" + gw.name + "</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId }).lean();
  if (!gw) return;
  var kb = new InlineKeyboard()
    .row({ text: "📝 Edit Name", callback_data: "auto_upi_edit_name_" + gwId, style: "primary" })
    .row({ text: "🌐 Edit URL", callback_data: "auto_upi_edit_url_" + gwId, style: "primary" })
    .row({ text: "⚙️ Edit Method", callback_data: "auto_upi_edit_method_" + gwId, style: "primary" })
    .row({ text: "💰 Set Min Amount", callback_data: "auto_upi_set_min_" + gwId, style: "primary" })
    .row({ text: "💰 Set Max Amount", callback_data: "auto_upi_set_max_" + gwId, style: "primary" })
    .row({ text: "Back", callback_data: "auto_upi_view_" + gwId, style: "primary" });
  await ctx.editMessageText("✏️ <b>Edit " + gw.name + "</b>\n\nChoose what to edit:", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_name_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_name_", "");
  userState[ctx.from.id] = "AUTO_UPI_EDIT_NAME_" + gwId;
  await ctx.editMessageText("📝 Send new name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_url_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_url_", "");
  userState[ctx.from.id] = "AUTO_UPI_EDIT_URL_" + gwId;
  await ctx.editMessageText("🌐 Send new URL:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_edit_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_edit_method_", "");
  await ctx.editMessageText("⚙️ Choose method:", {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .row({ text: "GET", callback_data: "auto_upi_set_method_" + gwId + "_GET", style: "primary" })
      .row({ text: "POST", callback_data: "auto_upi_set_method_" + gwId + "_POST", style: "primary" })
      .row({ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" })
  }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_method_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var data = ctx.callbackQuery.data.replace("auto_upi_set_method_", "");
  var parts = data.split("_");
  var method = parts.pop();
  var gwId = parts.join("_");
  await AutoUpi.updateOne({ gatewayId: gwId }, { method });
  await ctx.editMessageText("✅ Method set to " + method, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "auto_upi_view_" + gwId, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_min_", "");
  userState[ctx.from.id] = "AUTO_UPI_MIN_" + gwId;
  await ctx.editMessageText("💰 Send minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_max_", "");
  userState[ctx.from.id] = "AUTO_UPI_MAX_" + gwId;
  await ctx.editMessageText("💰 Send maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_edit_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_set_payout_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_set_payout_", "");
  userState[ctx.from.id] = "AUTO_UPI_PAYOUT_" + gwId;
  await ctx.editMessageText("📢 Send Payout Channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "auto_upi_view_" + gwId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_toggle_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_toggle_", "");
  var gw = await AutoUpi.findOne({ gatewayId: gwId });
  if (!gw) return;
  gw.status = gw.status === "active" ? "off" : "active";
  await gw.save();
  await ctx.answerCallbackQuery({ text: gw.status === "active" ? "🟢 ON" : "🔴 OFF" }).catch(() => { });
});

bot.callbackQuery(/^auto_upi_del_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var gwId = ctx.callbackQuery.data.replace("auto_upi_del_", "");
  await AutoUpi.deleteOne({ gatewayId: gwId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Auto UPI Deleted", gwId, 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Deleted!" }).catch(() => { });
  await renderAutoUpiMenu(ctx);
});

bot.callbackQuery("adm_manage_withdraw", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderManageWithdraw(ctx);
});

async function renderManageWithdraw(ctx) {
  var methods = ["upi", "bank", "amazon", "redeem"];
  for (var m = 0; m < methods.length; m++) {
    var s = await WithdrawSettings.findOne({ method: methods[m] });
    if (!s) await WithdrawSettings.create({ method: methods[m], isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
  }
  var settings = await WithdrawSettings.find({}).lean();
  var gateways = await Gateway.find({}).sort({ createdAt: 1 }).lean();
  var autoUpis = await AutoUpi.find({}).sort({ createdAt: 1 }).lean();
  var autoBanks = await AutoBank.find({}).sort({ createdAt: 1 }).lean();
  var text = "<b>Manage Withdraw</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Manual Withdraw</b>\n\n";
  for (var i = 0; i < methods.length; i++) {
    var s2 = settings.find(function(x) { return x.method === methods[i]; });
    if (!s2) continue;
    text += methods[i].toUpperCase() + " (" + RUPEE + s2.minAmount + " - " + RUPEE + s2.maxAmount + ") " + (s2.isActive ? "🟢" : "🔴") + "\n";
  }
  if (gateways.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto Gateway</b>\n\n";
    for (var gi = 0; gi < gateways.length; gi++) text += gateways[gi].name + " (" + RUPEE + (gateways[gi].minAmount || 0) + " - " + RUPEE + (gateways[gi].maxAmount || 0) + ") " + (gateways[gi].isActive ? "🟢" : "🔴") + "\n";
  }
  if (autoUpis.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto UPI</b>\n\n";
    for (var au = 0; au < autoUpis.length; au++) text += autoUpis[au].name + " (" + RUPEE + (autoUpis[au].minAmount || 0) + " - " + RUPEE + (autoUpis[au].maxAmount || 0) + ") " + (autoUpis[au].status === "active" ? "🟢" : "🔴") + "\n";
  }
  if (autoBanks.length > 0) {
    text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<b>Auto Bank</b>\n\n";
    for (var ab = 0; ab < autoBanks.length; ab++) text += autoBanks[ab].name + " (" + RUPEE + (autoBanks[ab].minAmount || 0) + " - " + RUPEE + (autoBanks[ab].maxAmount || 0) + ") " + (autoBanks[ab].status === "active" ? "🟢" : "🔴") + "\n";
  }
  text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nClick to edit:";
  var kb = new InlineKeyboard();
  for (var mi = 0; mi < methods.length; mi++) kb.row({ text: methods[mi].toUpperCase(), callback_data: "admwd_edit_" + methods[mi], style: "primary" });
  for (var g = 0; g < gateways.length; g++) kb.row({ text: gateways[g].name.toUpperCase(), callback_data: "gw_edit_" + gateways[g].name, style: "primary" });
  for (var a = 0; a < autoUpis.length; a++) kb.row({ text: "⚡ " + autoUpis[a].name, callback_data: "auto_upi_edit_" + autoUpis[a].gatewayId, style: "primary" });
  for (var b = 0; b < autoBanks.length; b++) kb.row({ text: "🏦 " + autoBanks[b].name, callback_data: "auto_bank_view_" + autoBanks[b].gatewayId, style: "primary" });
  kb.row({ text: "Back", callback_data: "adm_customize_theme", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery(/^admwd_edit_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_edit_", "");
  var s = await WithdrawSettings.findOne({ method: method });
  if (!s) s = await WithdrawSettings.create({ method: method, isActive: false, minAmount: 0, maxAmount: 0, taxPercent: 0, taxSlabs: [] });
  var text = "<b>" + method.toUpperCase() + " Settings</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nStatus: " + (s.isActive ? "🟢 ON" : "🔴 OFF") + "\nMin: " + RUPEE + s.minAmount + "\nMax: " + RUPEE + s.maxAmount + "\nTax Slabs: " + (s.taxSlabs || []).length + "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  var kb = new InlineKeyboard()
    .row({ text: "Set Min", callback_data: "admwd_min_" + method, style: "primary" })
    .row({ text: "Set Max", callback_data: "admwd_max_" + method, style: "primary" })
    .row({ text: "Set Tax Slabs", callback_data: "tax_edit_manual_" + method, style: "success" })
    .row({ text: s.isActive ? "Turn OFF" : "Turn ON", callback_data: "admwd_toggle_" + method, style: s.isActive ? "danger" : "success" })
    .row({ text: "Back", callback_data: "adm_manage_withdraw", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^admwd_toggle_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var method = ctx.callbackQuery.data.replace("admwd_toggle_", "");
  var s = await WithdrawSettings.findOne({ method: method });
  if (!s) s = await WithdrawSettings.create({ method: method, isActive: false });
  else { s.isActive = !s.isActive; s.updatedAt = new Date(); await s.save(); }
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Method Toggled", method + " -> " + (s.isActive ? "ON" : "OFF"), 0, null);
  await ctx.answerCallbackQuery({ text: s.isActive ? "ON" : "OFF" }).catch(() => { });
});

bot.callbackQuery(/^admwd_min_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_min_", "");
  userState[ctx.from.id] = "ADMWD_MIN_" + method;
  await ctx.editMessageText("Set Min Amount\n\nSend minimum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + method, style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery(/^admwd_max_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var method = ctx.callbackQuery.data.replace("admwd_max_", "");
  userState[ctx.from.id] = "ADMWD_MAX_" + method;
  await ctx.editMessageText("Set Max Amount\n\nSend maximum amount:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "admwd_edit_" + method, style: "primary" }]] } }).catch(() => { });
});

async function renderTaskManager(ctx) {
  var tasks = await Task.find({ isComplete: true }).sort({ createdAt: -1 }).lean();
  var text = "💡 <b>Here You Can Manage Your Tasks</b>\n\nSelect a task to view, edit, or delete it.";
  var kb = new InlineKeyboard();
  if (tasks.length === 0) kb.row({ text: "No Tasks", callback_data: "noop", style: "danger" });
  else {
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var shortName = t.title.length > 12 ? t.title.substring(0, 12) + ".." : t.title;
      var statusIcon = t.isActive !== false ? "🟢" : "🔴";
      kb.row(
        { text: "📄 " + shortName, callback_data: "view_task_" + t.taskId, style: "primary" },
        { text: "✏️", callback_data: "edit_task_" + t.taskId, style: "primary" },
        { text: "🗑️", callback_data: "del_task_" + t.taskId, style: "danger" },
        { text: statusIcon, callback_data: "toggle_task_" + t.taskId, style: t.isActive !== false ? "success" : "danger" }
      );
    }
  }
  kb.row({ text: "➕ Add New Task", callback_data: "adm_create_task", style: "success" }, { text: "Search Task", callback_data: "adm_search_task", style: "primary" });
  kb.row({ text: "➕ Add Channel For Task Alert", callback_data: "adm_task_alert_channel", style: "primary" });
  kb.row({ text: "⬅️ Back", callback_data: "admin", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("adm_tasks_manager", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderTaskManager(ctx);
});

bot.callbackQuery("adm_task_alert_channel", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "WAITING_TASK_ALERT_CHANNEL";
  var current = await getConfig("default_task_alert_channel", "Not Set");
  await ctx.editMessageText("➕ <b>Add Channel For Task Alert</b>\n\n📌 Current: <code>" + current + "</code>\n\n📝 Send Channel Username:\n\nExample:\n<code>@yourchannel</code>\n<code>-1001234567890</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_tasks_manager", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^view_task_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("view_task_", "");
  var task = await Task.findOne({ taskId: tId }).lean();
  if (!task) return;
  var bodyText = "Task ID: " + task.taskId + "\nName: " + task.title + "\nReward: " + RUPEE + task.reward + "\nLink: " + task.link + "\nType: " + (task.taskType || "photo") + "\nAlert Channel: " + (task.alertChannel || "Not Set") + "\nStatus: " + (task.isActive !== false ? "🟢 ON" : "🔴 OFF") + "\nCompleted: " + task.completedUsers.length + " users";
  if (task.expiresAt) bodyText += "\nExpires: " + formatDateTime(task.expiresAt);
  var kb = new InlineKeyboard()
    .row({ text: "Edit Title", callback_data: "task_edit_title_" + task.taskId, style: "primary" })
    .row({ text: "Edit Reward", callback_data: "task_edit_reward_" + task.taskId, style: "primary" })
    .row({ text: "Edit Link", callback_data: "task_edit_link_" + task.taskId, style: "primary" })
    .row({ text: "Edit Alert Channel", callback_data: "task_edit_channel_" + task.taskId, style: "primary" })
    .row({ text: "Type: " + (task.taskType || "photo").toUpperCase(), callback_data: "task_edit_type_" + task.taskId, style: "primary" })
    .row({ text: "Delete Task", callback_data: "del_task_" + task.taskId, style: "danger" })
    .row({ text: "Back", callback_data: "adm_tasks_manager", style: "primary" });
  await ctx.editMessageText("<b>Task Details</b>\n\n<blockquote>" + bodyText + "</blockquote>", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^del_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var tId = ctx.callbackQuery.data.replace("del_task_", "");
  var task = await Task.findOne({ taskId: tId }).lean();
  if (!task) { await ctx.answerCallbackQuery({ text: "Already deleted", show_alert: true }).catch(() => { }); return renderTaskManager(ctx); }
  await Task.deleteOne({ taskId: tId });
  await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Deleted", task.title + " (" + task.taskId + ")", 0, null);
  await ctx.answerCallbackQuery({ text: "🗑️ Task Deleted!" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^toggle_task_/, async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.answerCallbackQuery({ text: "Unauthorized", show_alert: true }).catch(() => { });
  var taskId = ctx.callbackQuery.data.replace("toggle_task_", "");
  var task = await Task.findOne({ taskId });
  if (!task) return ctx.answerCallbackQuery({ text: "Not found", show_alert: true }).catch(() => { });
  task.isActive = task.isActive === false ? true : false;
  await task.save();
  await ctx.answerCallbackQuery({ text: task.isActive ? "Activated" : "Deactivated" }).catch(() => { });
  await renderTaskManager(ctx);
});

bot.callbackQuery(/^task_edit_title_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_title_", "");
  userState[ctx.from.id] = "TASK_EDIT_TITLE_" + tId;
  await ctx.editMessageText("📝 Send new title:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_reward_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_reward_", "");
  userState[ctx.from.id] = "TASK_EDIT_REWARD_" + tId;
  await ctx.editMessageText("📝 Send new reward:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_link_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_link_", "");
  userState[ctx.from.id] = "TASK_EDIT_LINK_" + tId;
  await ctx.editMessageText("📝 Send new link:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_channel_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_channel_", "");
  userState[ctx.from.id] = "TASK_EDIT_CHANNEL_" + tId;
  await ctx.editMessageText("📝 Send new alert channel:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "view_task_" + tId, style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery(/^task_edit_type_/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var tId = ctx.callbackQuery.data.replace("task_edit_type_", "");
  var task = await Task.findOne({ taskId: tId });
  if (!task) return;
  var newType = (task.taskType || "photo") === "photo" ? "refer" : "photo";
  await Task.updateOne({ taskId: tId }, { taskType: newType });
  await ctx.answerCallbackQuery({ text: newType.toUpperCase() }).catch(() => { });
});

bot.callbackQuery("adm_create_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var newTaskId = "T" + Date.now().toString().slice(-10);
  global.taskCreation = global.taskCreation || {};
  global.taskCreation[ctx.from.id] = { taskId: newTaskId, title: null, reward: null, link: null, description: null, expiryMinutes: null };
  await ctx.editMessageText("<b>Task ID Auto-Generated</b>\n\n<code>" + newTaskId + "</code>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Create Task", callback_data: "task_create_start", style: "success" }], [{ text: "Back", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_create_start", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  await renderCreateTaskPanel(ctx);
});

async function renderCreateTaskPanel(ctx) {
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  var bodyText = "Task ID: <code>" + temp.taskId + "</code>\n\nTask Name: " + (temp.title || "Not Set") + "    " + (temp.title ? "✅" : "—") + "\nReward: " + (temp.reward ? RUPEE + temp.reward : "Not Set") + "    " + (temp.reward ? "✅" : "—") + "\nLink: " + (temp.link || "Not Set") + "    " + (temp.link ? "✅" : "—") + "\nDescription: " + (temp.description || "Not Set") + "    " + (temp.description ? "✅" : "—") + "\nTime Limit: " + (temp.expiryMinutes ? formatMinutes(temp.expiryMinutes) : "Not Set") + "    " + (temp.expiryMinutes ? "✅" : "—");
  var text = "<b>Create New Task</b>\n\n<blockquote>" + bodyText + "</blockquote>";
  var kb = new InlineKeyboard()
    .row({ text: "Task Name", callback_data: "task_field_name", style: "primary" })
    .row({ text: "Reward", callback_data: "task_field_reward", style: "primary" })
    .row({ text: "Link", callback_data: "task_field_link", style: "primary" })
    .row({ text: "Description", callback_data: "task_field_desc", style: "primary" })
    .row({ text: "Time Limit", callback_data: "task_field_timelimit", style: "primary" })
    .row({ text: "Generate", callback_data: "task_field_submit", style: "success" })
    .row({ text: "Back", callback_data: "adm_tasks_manager", style: "primary" });
  if (ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
  else await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
}

bot.callbackQuery("task_field_name", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_NAME";
  await ctx.editMessageText(toSmallCaps("Enter Task Name") + "\n\nSend the task name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_reward", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_REWARD";
  await ctx.editMessageText(toSmallCaps("Enter Reward") + "\n\nSend amount in INR:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_link", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_LINK";
  await ctx.editMessageText(toSmallCaps("Enter Task Link") + "\n\nSend the link:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_desc", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_DESC";
  await ctx.editMessageText(toSmallCaps("Enter Description") + "\n\nSend description (optional):", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_timelimit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var kb = new InlineKeyboard()
    .row({ text: "5 Minutes", callback_data: "task_tl_5", style: "primary" })
    .row({ text: "10 Minutes", callback_data: "task_tl_10", style: "primary" })
    .row({ text: "30 Minutes", callback_data: "task_tl_30", style: "primary" })
    .row({ text: "1 Hour", callback_data: "task_tl_60", style: "primary" })
    .row({ text: "1 Day", callback_data: "task_tl_1440", style: "primary" })
    .row({ text: "Custom Time", callback_data: "task_tl_custom", style: "primary" })
    .row({ text: "Back", callback_data: "task_create_start", style: "primary" });
  await ctx.editMessageText("<b>Time Limit</b>\n\nSelect task expiry time:", { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

bot.callbackQuery(/^task_tl_(\d+)$/, async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var minutes = parseInt(ctx.callbackQuery.data.replace("task_tl_", ""), 10);
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  temp.expiryMinutes = minutes;
  await ctx.editMessageText(toSmallCaps("Successfully Added") + "\n\nTime Limit: " + formatMinutes(minutes), { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_create_start", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_tl_custom", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_FIELD_CUSTOM_TIME";
  await ctx.editMessageText("Custom Time Limit\n\nSend time in minutes:\n\nExamples:\n• 5    (5 minutes)\n• 60   (1 hour)\n• 1440 (1 day)", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back", callback_data: "task_field_timelimit", style: "primary" }]] } }).catch(() => { });
});

bot.callbackQuery("task_field_submit", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var temp = global.taskCreation && global.taskCreation[ctx.from.id];
  if (!temp) return ctx.answerCallbackQuery({ text: "Session expired", show_alert: true }).catch(() => { });
  var missing = [];
  if (!temp.title) missing.push("Task Name");
  if (!temp.reward) missing.push("Reward");
  if (!temp.link) missing.push("Link");
  if (missing.length > 0) return ctx.answerCallbackQuery({ text: "Missing: " + missing.join(", "), show_alert: true }).catch(() => { });
  var alertChannel = await getConfig("default_task_alert_channel", "Not Set");
  var expiresAt = null;
  if (temp.expiryMinutes && temp.expiryMinutes > 0) expiresAt = new Date(Date.now() + temp.expiryMinutes * 60 * 1000);
  try {
    await Task.create({ taskId: temp.taskId, title: temp.title, reward: temp.reward, link: temp.link, description: temp.description || "", taskType: "photo", alertChannel: alertChannel, isActive: true, isComplete: true, completedUsers: [], expiryMinutes: temp.expiryMinutes || 0, expiresAt: expiresAt });
    await logAdminAction(ctx.from.id, ctx.from.first_name || "Admin", "Task Created", temp.title, temp.reward);
    delete global.taskCreation[ctx.from.id];
    var bodyText = "Task ID: <code>" + temp.taskId + "</code>\nName: " + temp.title + "\nReward: " + RUPEE + temp.reward + "\nLink: " + temp.link + "\n";
    if (temp.description) bodyText += "Description: " + temp.description + "\n";
    if (temp.expiryMinutes) bodyText += "Time Limit: " + formatMinutes(temp.expiryMinutes) + "\n";
    else bodyText += "Time Limit: None\n";
    bodyText += "Alert Channel: " + alertChannel;
    await ctx.editMessageText("<b>Task Created Successfully</b>\n\n<blockquote>" + bodyText + "</blockquote>", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Back to Manage Tasks", callback_data: "adm_tasks_manager", style: "primary" }]] } }).catch(() => { });
  } catch (e) { await ctx.reply("Error: " + e.message).catch(() => { }); }
});

bot.callbackQuery("adm_search_task", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  userState[ctx.from.id] = "TASK_SEARCH";
  await ctx.editMessageText("<b>Search Task</b>\n\nSend Task ID or Task Name:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: "adm_tasks_manager", style: "danger" }]] } }).catch(() => { });
});

bot.callbackQuery("adm_status", async (ctx) => {
  ctx.answerCallbackQuery().catch(() => { });
  if (!(await isAdmin(ctx.from.id))) return;
  var pendingCount = await Withdrawal.countDocuments({ status: "Pending" });
  var text = "<b>Status</b>\n\n👇 Choose option:";
  var kb = new InlineKeyboard()
    .row({ text: "Live Balance Tracker", callback_data: "status_live_tracker", style: "primary" })
    .row({ text: "Users List", callback_data: "status_users_list", style: "primary" })
    .row({ text: "Live Fund", callback_data: "status_live_fund", style: "primary" })
    .row({ text: "New Users", callback_data: "adm_new_users", style: "primary" })
    .row({ text: "Withdraw Requests (" + pendingCount + ")", callback_data: "status_wd_requests", style: "primary" })
    .row({ text: "Withdraw Stats", callback_data: "status_wd_stats", style: "primary" })
    .row({ text: "Back to Admin", callback_data: "admin", style: "primary" });
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" }).catch(() => { });
});

