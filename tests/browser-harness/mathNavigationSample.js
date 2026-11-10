export const mathNavigationSample = String.raw`# 公式上下移动样例

## 1. 单字符行内公式

这是公式上方的正文。把光标放到下一行的公式，试试 ↑ 和 ↓。

$p$

这是公式下方的正文，可以继续输入。

## 2. 较长的行内公式

下面这条公式的 LaTeX 源码很长。点击编辑后，源码会自动折行；↑↓先在源码内部移动，到首尾行再返回正文。

$\frac{\sum_{i=1}^{n}(x_i-\bar{x})(y_i-\bar{y})}{\sqrt{\sum_{i=1}^{n}(x_i-\bar{x})^2}\sqrt{\sum_{i=1}^{n}(y_i-\bar{y})^2}}+\frac{\lambda_1\alpha_1+\lambda_2\alpha_2+\lambda_3\alpha_3}{1+\exp(-\beta_0-\beta_1 x_i-\beta_2 z_i)}$

这里是长公式下方的正文。

## 3. 多行行间公式

行间公式中的 Enter 用于换行，Ctrl / ⌘ + Enter 完成编辑。↑↓在源码内部移动，到首尾行也可以离开。

$$
\begin{aligned}
\mathcal{L}(\theta)
&= \frac{1}{n}\sum_{i=1}^{n}\left(y_i-\beta_0-\sum_{j=1}^{d}\beta_j x_{ij}\right)^2 \\
&\quad + \lambda_1\sum_{j=1}^{d}|\beta_j| + \lambda_2\sum_{j=1}^{d}\beta_j^2 \\
\frac{\partial\mathcal{L}}{\partial\beta_k}
&= -\frac{2}{n}\sum_{i=1}^{n}x_{ik}\left(y_i-\beta_0-\sum_{j=1}^{d}\beta_j x_{ij}\right)
+ \lambda_1\operatorname{sgn}(\beta_k)+2\lambda_2\beta_k
\end{aligned}
$$

这里是多行公式之后的正文。
`
