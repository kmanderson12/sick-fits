import React from 'react';
import { Mutation } from 'react-apollo';
import gql from 'graphql-tag';

// failed attempt at running a mutation on mount

const CLOSE_CART_MUTATION = gql`
  mutation {
    closeCart @client
  }
`;

class MutationOnMount extends React.Component {
  componentDidMount() {
    this.props.client.mutate({
      mutation: CLOSE_CART_MUTATION
    });
  }

  render() {
    return null;
  }
}

export default MutationOnMount;
export { CLOSE_CART_MUTATION };
