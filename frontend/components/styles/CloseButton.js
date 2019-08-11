import styled from 'styled-components';

const CloseButton = styled.button`
  background: black;
  color: white;
  font-size: 3rem;
  border: 0;
  position: absolute;
  z-index: 2;
  right: 0;
  @media (max-width: 700px) {
    right: 10px;
  }
`;

export default CloseButton;
