const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');
const { hasPermission } = require('../utils');
const stripe = require('../stripe');

const Mutations = {
  async createItem(parent, args, ctx, info) {
    if (!ctx.request.userId) {
      throw new Error('You must be logged in to do that!');
    }

    const item = await ctx.db.mutation.createItem(
      {
        data: {
          //this is how we create relationship
          user: {
            connect: {
              id: ctx.request.userId
            }
          },
          ...args
        }
      },
      info
    );

    console.log(item);

    return item;
  },
  updateItem(parent, args, ctx, info) {
    // first take a copy of the updates
    const updates = { ...args };
    // remove the ID from the updates
    delete updates.id;
    // run the update method
    return ctx.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: args.id
        }
      },
      info
    );
  },

  async deleteItem(parent, args, ctx, info) {
    const where = { id: args.id };
    // find the item
    const item = await ctx.db.query.item(
      { where },
      `{ id
      title user { id } }`
    );
    // check if they own it/have permissions
    const ownsItem = item.user.id === ctx.request.userId;
    const hasPermissions = ctx.request.user.permissions.some(permission =>
      ['ADMIN', 'ITEMDELETE'].includes(permission)
    );
    if (!ownsItem && !hasPermissions) {
      throw new Error("You don't have permission to do that.");
    }

    // delete it
    return ctx.db.mutation.deleteItem({ where }, info);
  },

  async signup(parent, args, ctx, info) {
    args.email = args.email.toLowerCase();
    // hash their pw
    password = await bcrypt.hash(args.password, 10);

    //create the user in the db
    const user = await ctx.db.mutation.createUser(
      {
        data: {
          ...args,
          password,
          permissions: { set: ['USER'] }
        }
      },
      info
    );
    //create the JWT token
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    // set JWT as cookie on the response
    ctx.response.cookie('token', token, {
      //Set domain to custom domain name to resolve issue with non custom heroku/now domain names
      domain:
        process.env.NODE_ENV === 'development'
          ? process.env.LOCAL_DOMAIN
          : process.env.APP_DOMAIN,
      secure: process.env.NODE_ENV === 'development' ? false : true,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
      sameSite: 'lax'
    });
    // return user to browser
    return user;
  },

  async signin(parent, { email, password }, ctx, info) {
    //check if user with email
    const user = await ctx.db.query.user({ where: { email } });
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }

    //check if pw is correct
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error(`Invalid Password!`);
    }
    //generate jwt token
    const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
    //set the coolie with the token
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365 //1 year cookie
    });
    //return the user
    return user;
  },

  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token', {
      domain:
        process.env.NODE_ENV === 'development'
          ? process.env.LOCAL_DOMAIN
          : process.env.APP_DOMAIN
    });
    return { message: 'Goodbye!' };
  },
  async requestReset(parent, args, ctx, info) {
    // 1. check if this is a real user
    const user = await ctx.db.query.user({ where: { email: args.email } });

    if (!user) {
      throw new Error(`No such user found for email ${args.email}`);
    }
    // 2. set a reset token and expiry on that user
    const randomBytesPromisified = promisify(randomBytes);
    const resetToken = (await randomBytesPromisified(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000;
    const res = await ctx.db.mutation.updateUser({
      where: { email: args.email },
      data: { resetToken, resetTokenExpiry }
    });

    // 3. email them the token
    const mailRes = await transport.sendMail({
      from: 'kyle@kyle.com',
      to: user.email,
      subject: 'Your Password Reset Token',
      html: makeANiceEmail(`Your password reset token is here!
      \n\n
      <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">
      Click Here to Reset</a>`)
    });

    return { message: 'Thanks!' };
  },

  async resetPassword(parent, args, ctx, info) {
    // check if passwords match
    if (args.password != args.confirmPassword) {
      throw new Error("Yo passwords don't match!");
    }
    // check if good token
    // check if expired
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000
      }
    });
    if (!user) {
      throw new Error('This token is either invalid or expired!');
    }
    // hash their new password
    const password = await bcrypt.hash(args.password, 10);
    // save the new password
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email },
      data: {
        password,
        resetToken: null,
        resetTokenExpiry: null
      }
    });
    // generate jwt
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    // set the jwt cookie
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365 //sec min hr day yr
    });
    // return new user
    return updatedUser;
    // HHHWEWEW Have a beer
  },

  async updatePermissions(parent, args, ctx, info) {
    //check if logged in
    if (!ctx.request.userId) {
      throw new Error('You must be logged in!');
    }
    // query current user
    const currentUser = await ctx.db.query.user(
      {
        where: {
          id: ctx.request.userId
        }
      },
      info
    );
    // check if permissions
    hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);

    return ctx.db.mutation.updateUser(
      {
        data: {
          permissions: {
            set: args.permissions
          }
        },
        where: {
          id: args.userId
        }
      },
      info
    );
  },
  async addToCart(parent, args, ctx, info) {
    //1. check signed in
    const { userId } = ctx.request;
    if (!userId) {
      throw new Error('You must be signed in to do that!');
    }
    //2.  query current cart
    const [existingCartItem] = await ctx.db.query.cartItems({
      where: {
        user: { id: userId },
        item: { id: args.id }
      }
    });
    //3. check that item is already in cart and incr by 1 if is
    if (existingCartItem) {
      console.log('This item is already in their cart.');
      return ctx.db.mutation.updateCartItem(
        {
          where: { id: existingCartItem.id },
          data: { quantity: existingCartItem.quantity + 1 }
        },
        info
      );
    }
    //4. if not, create fresh cart item for that user
    return ctx.db.mutation.createCartItem(
      {
        data: {
          user: {
            connect: { id: userId }
          },
          item: {
            connect: { id: args.id }
          }
        }
      },
      info
    );
  },
  async removeFromCart(parent, args, ctx, info) {
    //1. find the cart item
    const cartItem = await ctx.db.query.cartItem(
      {
        where: {
          id: args.id
        }
      },
      `{ id, user { id } }`
    );
    //1.5 make sure we found an item
    if (!cartItem) throw new Error('No Cart Item Found!');
    //2. make sure they own it
    if (cartItem.user.id !== ctx.request.userId) {
      throw new Error('Cheatin huhh?');
    }

    //3. delete
    return ctx.db.mutation.deleteCartItem(
      {
        where: {
          id: args.id
        }
      },
      info
    );
  },

  async createOrder(parent, args, ctx, info) {
    // 1. Query the current user and make sure they're signed in
    const { userId } = ctx.request;
    if (!userId)
      throw new Error('You must be signed in to complete this order');
    const user = await ctx.db.query.user(
      { where: { id: userId } },
      `{
      id
      name
      email
      cart {
        id
        quantity
        item {title price id description image largeImage}
      }}`
    );
    // 2. recalculate the total for the price.
    const amount = user.cart.reduce(
      (tally, cartItem) => tally + cartItem.item.price * cartItem.quantity,
      0
    );
    console.log(`Going to charge for a total of ${amount}`);
    // 3. Create the Stripe charge (turn token into $$$)
    const charge = await stripe.charges.create({
      amount,
      currency: 'USD',
      source: args.token
    });
    // 4. Convert the cartItems to OrderItems
    const orderItems = user.cart.map(cartItem => {
      const orderItem = {
        ...cartItem.item,
        quantity: cartItem.quantity,
        user: {
          connect: { id: userId }
        }
      };
      delete orderItem.id;
      return orderItem;
    });
    // 5. Create the order
    const order = await ctx.db.mutation.createOrder({
      data: {
        total: charge.amount,
        charge: charge.id,
        items: { create: orderItems },
        user: {
          connect: { id: userId }
        }
      }
    });
    // 6. Clean up = clear the user's cart, delete cartItems
    const cartItemIds = user.cart.map(cartItem => cartItem.id);
    await ctx.db.mutation.deleteManyCartItems({
      where: {
        id_in: cartItemIds
      }
    });
    // 7. Return the Order to the client
    return order;
  }
};

module.exports = Mutations;
