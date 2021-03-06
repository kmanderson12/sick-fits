const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: 'variables.env' });
const createServer = require('./createServer');
const db = require('./db');

const server = createServer();

server.express.use(cookieParser());
// TODO Use express middleware to populate current user

server.express.use((req, res, next) => {
  const { token } = req.cookies;
  if (token) {
    const { userId } = jwt.verify(token, process.env.APP_SECRET);
    // put userId onto req for future req
    req.userId = userId;
  }
  next();
});

// 2. create middleware that populates user on each request

server.express.use(async (req, res, next) => {
  if (!req.userId) return next();
  const user = await db.query.user(
    {
      where: {
        id: req.userId
      }
    },
    '{ id, permissions, email, name }'
  );
  req.user = user;
  next();
});
//start it
server.start(
  {
    cors: {
      credentials: true,
      origin: [process.env.FRONTEND_URL, 'http://sickfits-kma-prd.herokuapp.com']
    }
  },
  deets => {
    console.log(`Server is now running on port http:/localhost:${deets.port}`);
  }
);
