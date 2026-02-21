import { Tool } from "./Tool";

/**
 * Calculator tool - demonstrates a simple, stateless computation tool
 * Shows how to validate multiple input types and perform operations
 */
const CalculatorTool: Tool = {
  name: "calculator",
  description: "Perform arithmetic operations. Usage: { operation: '+' | '-' | '*' | '/', a: number, b: number }",

  execute: async (args: Record<string, any>) => {
    const { operation, a, b } = args;

    // Validate numeric arguments
    if (typeof a !== "number") {
      throw new Error(`Argument 'a' must be a number, got: ${typeof a}`);
    }

    if (typeof b !== "number") {
      throw new Error(`Argument 'b' must be a number, got: ${typeof b}`);
    }

    // Validate operation
    if (!operation) {
      throw new Error("Missing required argument: operation");
    }

    let result: number;
    let operationName: string;

    switch (operation) {
      case "+":
      case "add":
        result = a + b;
        operationName = "addition";
        break;

      case "-":
      case "subtract":
        result = a - b;
        operationName = "subtraction";
        break;

      case "*":
      case "multiply":
        result = a * b;
        operationName = "multiplication";
        break;

      case "/":
      case "divide":
        if (b === 0) {
          throw new Error("Cannot divide by zero");
        }
        result = a / b;
        operationName = "division";
        break;

      case "%":
      case "modulo":
        if (b === 0) {
          throw new Error("Cannot perform modulo with zero divisor");
        }
        result = a % b;
        operationName = "modulo";
        break;

      case "**":
      case "power":
        result = Math.pow(a, b);
        operationName = "exponentiation";
        break;

      default:
        throw new Error(
          `Unknown operation: '${operation}'. Supported: +, -, *, /, %, ** (or add, subtract, multiply, divide, modulo, power)`
        );
    }

    return {
      operationName,
      operation,
      operands: { a, b },
      result,
      expression: `${a} ${operation} ${b} = ${result}`,
    };
  },
};

export default CalculatorTool;
