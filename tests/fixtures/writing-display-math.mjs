export const displayMathEditingSample = String.raw`\begin{aligned}
\mathcal F_{\mu,\nu,\lambda}(\mathbf X)
={}&
\sum_{m=0}^{\infty}\sum_{n=0}^{m}
\frac{(-1)^{m+n}\lambda^{m+\nu}}
{(m-n)!\,n!\,\Gamma(\mu n+\nu+1)}
\left(1+\|\mathbf X\|_F^2\right)^{-(m+\nu)/2} \\
&\times
\prod_{j=1}^{m}\left[
\int_{0}^{\infty}
\frac{t_j^{\mu-1}e^{-t_j}}
{1+\sin^2(\lambda t_j)+\dfrac{\|\mathbf X\|_F^2}{j^2}}
\,dt_j
\right] \\
&\times
{}_2F_1\!\left(
\begin{matrix}
\dfrac{m+\nu}{2},\,-\dfrac{\mu}{2}\\[4pt]
\nu+1
\end{matrix};
\frac{\|\mathbf X\|_F^2}{1+\|\mathbf X\|_F^2}
\right)
\end{aligned}`
