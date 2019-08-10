import React from 'react';
import { ApolloConsumer } from 'react-apollo';
import { MutationOnMount } from './MutationOnMount';

// failed attempt at running a mutation on mount

const CloseCartMutation = props => {
  return (
    <ApolloConsumer>
      {client => <MutationOnMount client={client} />}
    </ApolloConsumer>
  );
};

export default CloseCartMutation;
