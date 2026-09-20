const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret-please-change',
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,

    // Render/HTTPS ortamında true
    secure: process.env.NODE_ENV === 'production',

    sameSite: 'lax',

    maxAge: 24 * 60 * 60 * 1000
  }
}));
